/**
 * Kaneru Dojo — Venture Templates
 *
 * Pre-built venture templates that install a complete setup: agents with
 * roles and escalation hierarchy, directive trees, and fuel limits.
 *
 * Templates can be bundled (3 built-in) or downloaded from the Skill Hub
 * marketplace. Hub templates are fetched via HubClient and parsed as
 * DojoTemplate JSON.
 *
 * `mayros kaneru dojo install security-audit --name "My Sec Team"`
 * creates a fully configured venture in one command.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { VentureManager } from "./venture.js";
import type { ChainManager } from "./chain.js";
import type { DirectiveManager } from "./directives.js";

// ============================================================================
// Types
// ============================================================================

export type DojoAgent = {
  agentId: string;
  role: string;
  escalatesTo?: string;
  pulseInterval?: string;
};

export type DojoDirective = {
  title: string;
  level: "strategic" | "objective" | "task";
  parentIndex?: number;
};

export type DojoTemplate = {
  id: string;
  name: string;
  description: string;
  version: string;
  agents: DojoAgent[];
  directives: DojoDirective[];
  ventureDefaults: {
    fuelLimit?: number;
    prefix: string;
  };
};

export type DojoInstallResult = {
  ventureId: string;
  ventureName: string;
  prefix: string;
  agentsDeployed: number;
  directivesCreated: number;
  templateId: string;
};

// ============================================================================
// Bundled Templates
// ============================================================================

const BUNDLED_TEMPLATES: DojoTemplate[] = [
  {
    id: "security-audit",
    name: "Security Audit Squad",
    description:
      "Three-agent squad for comprehensive security auditing: scanner finds vulnerabilities, reviewer triages severity, fixer implements patches.",
    version: "1.0.0",
    agents: [
      { agentId: "scanner", role: "Vulnerability Scanner", pulseInterval: "4h" },
      {
        agentId: "reviewer",
        role: "Security Reviewer",
        escalatesTo: "scanner",
        pulseInterval: "2h",
      },
      { agentId: "fixer", role: "Patch Author", escalatesTo: "reviewer", pulseInterval: "1h" },
    ],
    directives: [
      { title: "Maintain secure codebase", level: "strategic" },
      { title: "Identify and classify vulnerabilities", level: "objective", parentIndex: 0 },
      {
        title: "Remediate critical and high severity findings",
        level: "objective",
        parentIndex: 0,
      },
      { title: "Run OWASP Top 10 scan", level: "task", parentIndex: 1 },
      { title: "Review dependency audit results", level: "task", parentIndex: 1 },
      { title: "Patch critical vulnerabilities", level: "task", parentIndex: 2 },
    ],
    ventureDefaults: { fuelLimit: 10000, prefix: "SEC" },
  },
  {
    id: "content-pipeline",
    name: "Content Pipeline",
    description:
      "Writer-editor-publisher pipeline for content creation with review gates and quality checks.",
    version: "1.0.0",
    agents: [
      { agentId: "writer", role: "Content Writer", pulseInterval: "6h" },
      { agentId: "editor", role: "Editor", escalatesTo: "writer", pulseInterval: "4h" },
      { agentId: "publisher", role: "Publisher", escalatesTo: "editor", pulseInterval: "2h" },
    ],
    directives: [
      { title: "Produce high-quality content", level: "strategic" },
      { title: "Draft and refine articles", level: "objective", parentIndex: 0 },
      { title: "Review and approve for publication", level: "objective", parentIndex: 0 },
      { title: "Write initial draft", level: "task", parentIndex: 1 },
      { title: "Edit for clarity and accuracy", level: "task", parentIndex: 1 },
      { title: "Publish to target channels", level: "task", parentIndex: 2 },
    ],
    ventureDefaults: { fuelLimit: 5000, prefix: "PUB" },
  },
  {
    id: "devops-squad",
    name: "DevOps Squad",
    description:
      "Deploy-monitor-respond cycle for infrastructure operations with automated alerting and incident response.",
    version: "1.0.0",
    agents: [
      { agentId: "deployer", role: "Release Engineer", pulseInterval: "1h" },
      {
        agentId: "monitor",
        role: "Observability Agent",
        escalatesTo: "deployer",
        pulseInterval: "30m",
      },
      {
        agentId: "responder",
        role: "Incident Responder",
        escalatesTo: "monitor",
        pulseInterval: "15m",
      },
    ],
    directives: [
      { title: "Maintain reliable infrastructure", level: "strategic" },
      { title: "Automate deployment pipeline", level: "objective", parentIndex: 0 },
      { title: "Monitor and respond to incidents", level: "objective", parentIndex: 0 },
      { title: "Run deployment with rollback plan", level: "task", parentIndex: 1 },
      { title: "Check health metrics post-deploy", level: "task", parentIndex: 1 },
      { title: "Triage and resolve alerts", level: "task", parentIndex: 2 },
    ],
    ventureDefaults: { fuelLimit: 15000, prefix: "OPS" },
  },
];

// ============================================================================
// DojoService
// ============================================================================

export class DojoService {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly ventureManager: VentureManager,
    private readonly chainManager: ChainManager,
    private readonly directiveManager: DirectiveManager,
  ) {}

  /** List all available templates. */
  listTemplates(): DojoTemplate[] {
    return BUNDLED_TEMPLATES;
  }

  /** Get a template by ID. */
  getTemplate(id: string): DojoTemplate | null {
    return BUNDLED_TEMPLATES.find((t) => t.id === id) ?? null;
  }

  /** Install a bundled template: create venture, deploy agents, create directives. */
  async install(templateId: string, ventureName: string): Promise<DojoInstallResult> {
    const template = this.getTemplate(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);
    return this.installTemplate(template, ventureName);
  }

  /** Preview a template as human-readable text. */
  preview(templateId: string): string {
    const template = this.getTemplate(templateId);
    if (!template) return `Template not found: ${templateId}`;

    const lines = [
      `Template: ${template.name} (${template.id} v${template.version})`,
      `${template.description}`,
      ``,
      `Prefix: ${template.ventureDefaults.prefix}`,
      `Fuel limit: ${template.ventureDefaults.fuelLimit ?? "unlimited"} cents`,
      ``,
      `Agents (${template.agents.length}):`,
      ...template.agents.map((a) => {
        const esc = a.escalatesTo ? ` → escalates to ${a.escalatesTo}` : "";
        const pulse = a.pulseInterval ? ` (pulse: ${a.pulseInterval})` : "";
        return `  ${a.agentId} [${a.role}]${esc}${pulse}`;
      }),
      ``,
      `Directives (${template.directives.length}):`,
      ...template.directives.map((d) => {
        const indent = d.level === "strategic" ? "  " : d.level === "objective" ? "    " : "      ";
        return `${indent}[${d.level}] ${d.title}`;
      }),
    ];

    return lines.join("\n");
  }

  /**
   * Search for templates on the Skill Hub marketplace (hub.apilium.com).
   * Returns templates published with the "dojo-template" category.
   *
   * Uses the existing HubClient from skill-hub extension — same client
   * used by `mayros hub search`. No duplicate marketplace.
   */
  async searchHub(
    query?: string,
    hubUrl?: string,
  ): Promise<Array<{ slug: string; name: string; description: string; version: string }>> {
    const hub = await this.resolveHubClient(hubUrl);
    if (!hub) return [];

    try {
      const result = await hub.search(query ?? "dojo", { category: "dojo-template", limit: 20 });
      return result.skills.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        version: s.version,
      }));
    } catch {
      return []; // Hub unreachable
    }
  }

  /**
   * Download and install a template from the Skill Hub (hub.apilium.com).
   * Fetches the template archive, parses as DojoTemplate JSON, and installs.
   */
  async installFromHub(
    slug: string,
    ventureName: string,
    hubUrl?: string,
  ): Promise<DojoInstallResult> {
    const hub = await this.resolveHubClient(hubUrl);
    if (!hub)
      throw new Error("Skill Hub extension not available. Install the skill-hub plugin first.");

    const archive = await hub.download(slug);

    let template: DojoTemplate;
    try {
      template = JSON.parse(archive.toString("utf-8")) as DojoTemplate;
    } catch {
      throw new Error(`Failed to parse template "${slug}" — expected valid DojoTemplate JSON`);
    }

    if (!template.id || !template.agents || !template.directives || !template.ventureDefaults) {
      throw new Error(`Invalid template "${slug}" — missing required fields`);
    }

    if (template.agents.length > 20) {
      throw new Error(`Template "${slug}" has too many agents (${template.agents.length}, max 20)`);
    }
    if (template.directives.length > 50) {
      throw new Error(
        `Template "${slug}" has too many directives (${template.directives.length}, max 50)`,
      );
    }
    // Validate agent IDs are alphanumeric
    for (const agent of template.agents) {
      if (!/^[a-zA-Z0-9_-]+$/.test(agent.agentId)) {
        throw new Error(`Template "${slug}" has invalid agent ID: "${agent.agentId}"`);
      }
    }

    return this.installTemplate(template, ventureName);
  }

  /**
   * Resolve HubClient from skill-hub extension.
   * Uses hub.apilium.com as default (same as `mayros hub` commands).
   */
  private async resolveHubClient(hubUrl?: string): Promise<{
    search: (
      q: string,
      opts?: { category?: string; limit?: number },
    ) => Promise<{
      skills: Array<{ slug: string; name: string; description: string; version: string }>;
    }>;
    download: (slug: string, version?: string) => Promise<Buffer>;
  } | null> {
    try {
      const { HubClient } = await import("../skill-hub/hub-client.js");
      return new HubClient(hubUrl ?? "https://hub.apilium.com");
    } catch {
      return null;
    }
  }

  /** Internal: install a parsed DojoTemplate. Shared by install() and installFromHub(). */
  private async installTemplate(
    template: DojoTemplate,
    ventureName: string,
  ): Promise<DojoInstallResult> {
    const venture = await this.ventureManager.create({
      name: ventureName,
      directive: template.directives[0]?.title ?? template.description,
      fuelLimit: template.ventureDefaults.fuelLimit,
      prefix: template.ventureDefaults.prefix,
    });

    for (const agent of template.agents) {
      await this.chainManager.deploy(agent.agentId, venture.id, agent.role);
    }

    for (const agent of template.agents) {
      if (agent.escalatesTo) {
        await this.chainManager.setEscalation(agent.agentId, agent.escalatesTo);
      }
    }

    const directiveIds: string[] = [];
    for (const dir of template.directives) {
      const parentId = dir.parentIndex !== undefined ? directiveIds[dir.parentIndex] : undefined;
      const created = await this.directiveManager.create({
        title: dir.title,
        level: dir.level,
        ventureId: venture.id,
        parentId,
      });
      directiveIds.push(created.id);
    }

    return {
      ventureId: venture.id,
      ventureName,
      prefix: venture.prefix,
      agentsDeployed: template.agents.length,
      directivesCreated: directiveIds.length,
      templateId: template.id,
    };
  }
}
