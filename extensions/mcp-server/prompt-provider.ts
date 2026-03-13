/**
 * MCP Prompt Provider.
 *
 * Exposes reusable prompt templates:
 *   - project-context     — Active conventions + recent findings
 *   - resolve-rules       — Hierarchically resolved rules for a scope
 *   - agent-identity      — Load a specific agent's system prompt
 *   - code-review         — Code review workflow instructions
 *   - security-review     — Security audit workflow instructions
 *   - feature-development — Feature development workflow phases
 *
 * Each prompt accepts arguments and returns structured messages
 * ready for LLM consumption.
 */

import type { McpPromptDef, McpPromptMessage } from "./protocol.js";
import { McpError, ErrorCodes } from "./protocol.js";

// ============================================================================
// Data Source Interfaces
// ============================================================================

export type PromptDataSources = {
  listConventions: () => Promise<Array<{ text: string; category: string; confidence: number }>>;
  resolveRules: (
    scope: string,
    target?: string,
  ) => Promise<Array<{ content: string; scope: string; priority: number }>>;
  getAgentIdentity: (agentId: string) => string | null;
  listAgentIds: () => string[];
};

// ============================================================================
// Prompt Definitions
// ============================================================================

const PROMPT_DEFINITIONS: McpPromptDef[] = [
  {
    name: "project-context",
    description: "Load active project conventions and rules as context for code generation",
    arguments: [
      {
        name: "category",
        description:
          "Filter conventions by category (naming, architecture, testing, security, style, tooling)",
        required: false,
      },
    ],
  },
  {
    name: "resolve-rules",
    description: "Get hierarchically resolved rules for a specific scope and target",
    arguments: [
      {
        name: "scope",
        description: "Rule scope: global, project, agent, skill, or file",
        required: true,
      },
      {
        name: "target",
        description: "Scope target (agent name, file path, etc.)",
        required: false,
      },
    ],
  },
  {
    name: "agent-identity",
    description: "Load a specific agent's system prompt / identity instructions",
    arguments: [
      {
        name: "agent",
        description: "Agent ID to load",
        required: true,
      },
    ],
  },
  {
    name: "code-review",
    description: "Code review workflow: static analysis, security, and quality checks",
    arguments: [
      {
        name: "language",
        description: "Primary programming language (e.g., typescript, python, rust)",
        required: false,
      },
      {
        name: "focus",
        description: "Review focus: security, performance, correctness, or all",
        required: false,
      },
    ],
  },
  {
    name: "security-review",
    description: "Security audit workflow: threat modeling, input validation, authorization",
    arguments: [
      {
        name: "scope",
        description: "Audit scope: api, frontend, infra, or full",
        required: false,
      },
    ],
  },
  {
    name: "feature-development",
    description: "Feature development workflow: explore, design, implement, review",
    arguments: [
      {
        name: "feature",
        description: "Feature description",
        required: true,
      },
      {
        name: "phase",
        description: "Current phase: explore, design, implement, or review",
        required: false,
      },
    ],
  },
  {
    name: "dag-audit",
    description:
      "Audit the semantic DAG for a subject: review history, verify signatures, and diff changes",
    arguments: [
      {
        name: "subject",
        description: "Subject to audit (e.g., 'project:api')",
        required: true,
      },
      {
        name: "depth",
        description: "Number of recent actions to review (default: 10)",
        required: false,
      },
    ],
  },
];

// ============================================================================
// Prompt Provider
// ============================================================================

export class McpPromptProvider {
  private sources: PromptDataSources;

  constructor(sources: PromptDataSources) {
    this.sources = sources;
  }

  /** Update data sources. */
  updateSources(sources: Partial<PromptDataSources>): void {
    this.sources = { ...this.sources, ...sources };
  }

  /** List all available prompts. */
  listPrompts(): McpPromptDef[] {
    return PROMPT_DEFINITIONS;
  }

  /** Get a prompt's messages by name and arguments. */
  async getPrompt(name: string, args: Record<string, string>): Promise<McpPromptMessage[]> {
    switch (name) {
      case "project-context":
        return this.buildProjectContext(args.category);

      case "resolve-rules":
        return this.buildResolveRules(args.scope, args.target);

      case "agent-identity":
        return this.buildAgentIdentity(args.agent);

      case "code-review":
        return this.buildCodeReview(args.language, args.focus);

      case "security-review":
        return this.buildSecurityReview(args.scope);

      case "feature-development":
        return this.buildFeatureDev(args.feature, args.phase);

      case "dag-audit":
        return this.buildDagAudit(args.subject, args.depth);

      default:
        throw new McpError(ErrorCodes.PROMPT_NOT_FOUND, `Unknown prompt: ${name}`);
    }
  }

  // ── Prompt Builders ─────────────────────────────────────────────────

  private async buildProjectContext(category?: string): Promise<McpPromptMessage[]> {
    let conventions = await this.sources.listConventions();
    if (category) {
      conventions = conventions.filter((c) => c.category === category);
    }

    if (conventions.length === 0) {
      return [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "No project conventions found. The project has no recorded conventions yet.",
          },
        },
      ];
    }

    const lines = conventions.map(
      (c) => `- [${c.category}] (confidence: ${c.confidence}) ${c.text}`,
    );

    return [
      {
        role: "assistant",
        content: {
          type: "text",
          text: `# Project Conventions\n\nFollow these project conventions when generating or modifying code:\n\n${lines.join("\n")}`,
        },
      },
    ];
  }

  private async buildResolveRules(scope?: string, target?: string): Promise<McpPromptMessage[]> {
    if (!scope) {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing required argument: scope");
    }

    const rules = await this.sources.resolveRules(scope, target);

    if (rules.length === 0) {
      return [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `No rules found for scope "${scope}"${target ? ` target "${target}"` : ""}.`,
          },
        },
      ];
    }

    const ruleLines = rules.map((r) => `- [${r.scope}:${r.priority}] ${r.content}`);

    return [
      {
        role: "assistant",
        content: {
          type: "text",
          text: `# Active Rules (${scope}${target ? `:${target}` : ""})\n\nApply these rules in your reasoning:\n\n${ruleLines.join("\n")}`,
        },
      },
    ];
  }

  private buildAgentIdentity(agentId?: string): McpPromptMessage[] {
    if (!agentId) {
      // List available agents
      const ids = this.sources.listAgentIds();
      return [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `Available agents: ${ids.join(", ")}`,
          },
        },
      ];
    }

    const identity = this.sources.getAgentIdentity(agentId);
    if (!identity) {
      throw new McpError(ErrorCodes.PROMPT_NOT_FOUND, `Agent not found: ${agentId}`);
    }

    return [
      {
        role: "assistant",
        content: { type: "text", text: identity },
      },
    ];
  }

  private buildCodeReview(language?: string, focus?: string): McpPromptMessage[] {
    const lang = language ?? "the project's primary language";
    const reviewFocus = focus ?? "all";

    const instructions = [
      `# Code Review Workflow`,
      ``,
      `## Context`,
      `- Language: ${lang}`,
      `- Focus: ${reviewFocus}`,
      ``,
      `## Phase 1: Static Analysis`,
      `- Check for type errors, unused variables, and dead code`,
      `- Verify consistent naming conventions`,
      `- Look for code duplication opportunities`,
      ``,
      `## Phase 2: Security`,
      `- Check for injection vulnerabilities (SQL, XSS, command)`,
      `- Verify input validation at system boundaries`,
      `- Check for hardcoded secrets or credentials`,
      `- Review authentication and authorization patterns`,
      ``,
      `## Phase 3: Quality`,
      `- Verify error handling coverage`,
      `- Check test coverage for new/modified code`,
      `- Review API contracts and documentation`,
      `- Assess performance implications`,
    ];

    if (reviewFocus === "security") {
      instructions.push(
        ``,
        `## Security Priority`,
        `Focus exclusively on security concerns. Flag all OWASP Top 10 issues.`,
      );
    } else if (reviewFocus === "performance") {
      instructions.push(
        ``,
        `## Performance Priority`,
        `Focus on algorithmic complexity, memory allocation, and I/O patterns.`,
      );
    }

    return [
      {
        role: "assistant",
        content: { type: "text", text: instructions.join("\n") },
      },
    ];
  }

  private buildSecurityReview(scope?: string): McpPromptMessage[] {
    const auditScope = scope ?? "full";

    const instructions = [
      `# Security Review Workflow`,
      ``,
      `## Scope: ${auditScope}`,
      ``,
      `## Phase 1: Threat Modeling`,
      `- Identify attack surfaces and trust boundaries`,
      `- Map data flows and identify sensitive data paths`,
      `- Document authentication and authorization mechanisms`,
      ``,
      `## Phase 2: Input Validation`,
      `- Verify all user input is validated and sanitized`,
      `- Check for injection vulnerabilities`,
      `- Review file upload handling`,
      `- Verify URL and redirect validation`,
      ``,
      `## Phase 3: Authorization`,
      `- Review access control implementations`,
      `- Check for privilege escalation paths`,
      `- Verify resource-level permissions`,
      `- Review API rate limiting and abuse prevention`,
    ];

    return [
      {
        role: "assistant",
        content: { type: "text", text: instructions.join("\n") },
      },
    ];
  }

  private buildFeatureDev(feature?: string, phase?: string): McpPromptMessage[] {
    if (!feature) {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing required argument: feature");
    }

    const currentPhase = phase ?? "explore";

    const phaseInstructions: Record<string, string> = {
      explore: [
        `# Feature Development: ${feature}`,
        `## Phase: Explore`,
        ``,
        `1. Understand the existing codebase architecture`,
        `2. Identify related files, modules, and dependencies`,
        `3. Map out the current data flow`,
        `4. Document assumptions and constraints`,
        `5. List questions that need clarification`,
      ].join("\n"),
      design: [
        `# Feature Development: ${feature}`,
        `## Phase: Design`,
        ``,
        `1. Define the API contract (inputs, outputs, errors)`,
        `2. Choose architectural patterns that fit existing codebase`,
        `3. Plan file structure and module organization`,
        `4. Design test strategy (unit, integration, e2e)`,
        `5. Document trade-offs and decisions`,
      ].join("\n"),
      implement: [
        `# Feature Development: ${feature}`,
        `## Phase: Implement`,
        ``,
        `1. Write implementation following the design`,
        `2. Add comprehensive error handling`,
        `3. Write tests alongside implementation`,
        `4. Follow existing code conventions`,
        `5. Keep changes minimal and focused`,
      ].join("\n"),
      review: [
        `# Feature Development: ${feature}`,
        `## Phase: Review`,
        ``,
        `1. Run all tests and verify they pass`,
        `2. Review diff for unnecessary changes`,
        `3. Check for security implications`,
        `4. Verify documentation is updated`,
        `5. Ensure backward compatibility`,
      ].join("\n"),
    };

    const text = phaseInstructions[currentPhase] ?? phaseInstructions.explore!;

    return [
      {
        role: "assistant",
        content: { type: "text", text },
      },
    ];
  }

  private buildDagAudit(subject?: string, depth?: string): McpPromptMessage[] {
    if (!subject) {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing required argument: subject");
    }

    const parsed = depth ? parseInt(depth, 10) : 10;
    const limit = Number.isNaN(parsed) || parsed < 1 ? 10 : parsed;

    const instructions = [
      `# DAG Audit: ${subject}`,
      ``,
      `## Objective`,
      `Perform a complete audit of the semantic DAG for subject "${subject}".`,
      `Review the last ${limit} actions, verify signatures, and identify anomalies.`,
      ``,
      `## Step 1: Retrieve History`,
      `Use the \`mayros_dag_history\` tool with:`,
      `  - subject: "${subject}"`,
      `  - limit: ${limit}`,
      ``,
      `Review each action's payload type, author, timestamp, and sequence number.`,
      `Flag any gaps in sequence numbers or unexpected authors.`,
      ``,
      `## Step 2: Verify Signatures`,
      `For each signed action in the history, use the \`mayros_dag_verify\` tool`,
      `to confirm Ed25519 signature validity. Report any invalid signatures.`,
      ``,
      `## Step 3: Diff Analysis`,
      `If there are at least 2 actions, use \`mayros_dag_diff\` between the`,
      `oldest and newest action hashes to see the full change set.`,
      `Summarize what changed and whether the mutations are consistent.`,
      ``,
      `## Output Format`,
      `Provide a structured audit report with:`,
      `- Timeline of actions`,
      `- Signature verification results`,
      `- Anomalies or concerns`,
      `- Summary assessment`,
    ];

    return [
      {
        role: "assistant",
        content: { type: "text", text: instructions.join("\n") },
      },
    ];
  }
}
