import { describe, it, expect, beforeEach } from "vitest";
import { McpPromptProvider, type PromptDataSources } from "./prompt-provider.js";

// ── Mock data sources ─────────────────────────────────────────────────

function createMockSources(): PromptDataSources {
  return {
    listConventions: async () => [
      { text: "Use TypeScript strict mode", category: "tooling", confidence: 0.9 },
      { text: "Prefer composition over inheritance", category: "architecture", confidence: 0.8 },
    ],
    resolveRules: async (scope, _target?) => {
      if (scope === "global") {
        return [
          { content: "Always run tests before committing", scope: "global", priority: 100 },
          { content: "No hardcoded secrets", scope: "global", priority: 200 },
        ];
      }
      return [];
    },
    getAgentIdentity: (id) => {
      if (id === "coder") return "You are a coding assistant.";
      return null;
    },
    listAgentIds: () => ["coder", "reviewer"],
  };
}

describe("McpPromptProvider", () => {
  let provider: McpPromptProvider;

  beforeEach(() => {
    provider = new McpPromptProvider(createMockSources());
  });

  // 1
  it("listPrompts returns all prompt definitions", () => {
    const prompts = provider.listPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(6);
    const names = prompts.map((p) => p.name);
    expect(names).toContain("project-context");
    expect(names).toContain("resolve-rules");
    expect(names).toContain("agent-identity");
    expect(names).toContain("code-review");
    expect(names).toContain("security-review");
    expect(names).toContain("feature-development");
  });

  // 2
  it("project-context returns conventions", async () => {
    const messages = await provider.getPrompt("project-context", {});
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content.text).toContain("TypeScript strict");
    expect(messages[0]!.content.text).toContain("composition over inheritance");
  });

  // 3
  it("project-context filters by category", async () => {
    const messages = await provider.getPrompt("project-context", { category: "tooling" });
    expect(messages[0]!.content.text).toContain("TypeScript strict");
    expect(messages[0]!.content.text).not.toContain("composition");
  });

  // 4
  it("project-context returns fallback for empty conventions", async () => {
    provider.updateSources({ listConventions: async () => [] });
    const messages = await provider.getPrompt("project-context", {});
    expect(messages[0]!.content.text).toContain("No project conventions");
  });

  // 5
  it("resolve-rules returns global rules", async () => {
    const messages = await provider.getPrompt("resolve-rules", { scope: "global" });
    expect(messages[0]!.content.text).toContain("run tests");
    expect(messages[0]!.content.text).toContain("hardcoded secrets");
  });

  // 6
  it("resolve-rules returns empty for unknown scope", async () => {
    const messages = await provider.getPrompt("resolve-rules", { scope: "nonexistent" });
    expect(messages[0]!.content.text).toContain("No rules found");
  });

  // 7
  it("resolve-rules throws without scope", async () => {
    await expect(provider.getPrompt("resolve-rules", {})).rejects.toThrow("scope");
  });

  // 8
  it("agent-identity returns agent system prompt", async () => {
    const messages = await provider.getPrompt("agent-identity", { agent: "coder" });
    expect(messages[0]!.content.text).toBe("You are a coding assistant.");
  });

  // 9
  it("agent-identity lists available agents without id", async () => {
    const messages = await provider.getPrompt("agent-identity", {});
    expect(messages[0]!.content.text).toContain("coder");
    expect(messages[0]!.content.text).toContain("reviewer");
  });

  // 10
  it("agent-identity throws for unknown agent", async () => {
    await expect(provider.getPrompt("agent-identity", { agent: "nonexistent" })).rejects.toThrow();
  });

  // 11
  it("code-review returns workflow instructions", async () => {
    const messages = await provider.getPrompt("code-review", {
      language: "typescript",
      focus: "security",
    });
    expect(messages[0]!.content.text).toContain("typescript");
    expect(messages[0]!.content.text).toContain("Security Priority");
  });

  // 12
  it("code-review defaults to all focus", async () => {
    const messages = await provider.getPrompt("code-review", {});
    expect(messages[0]!.content.text).toContain("Phase 1");
    expect(messages[0]!.content.text).toContain("Phase 2");
    expect(messages[0]!.content.text).toContain("Phase 3");
  });

  // 13
  it("security-review returns audit workflow", async () => {
    const messages = await provider.getPrompt("security-review", { scope: "api" });
    expect(messages[0]!.content.text).toContain("api");
    expect(messages[0]!.content.text).toContain("Threat Modeling");
  });

  // 14
  it("feature-development with explore phase", async () => {
    const messages = await provider.getPrompt("feature-development", {
      feature: "dark mode",
      phase: "explore",
    });
    expect(messages[0]!.content.text).toContain("dark mode");
    expect(messages[0]!.content.text).toContain("Explore");
  });

  // 15
  it("feature-development throws without feature", async () => {
    await expect(provider.getPrompt("feature-development", {})).rejects.toThrow("feature");
  });

  // 16
  it("unknown prompt throws PROMPT_NOT_FOUND", async () => {
    await expect(provider.getPrompt("nonexistent", {})).rejects.toThrow();
  });

  // 17
  it("listPrompts includes dag-audit", () => {
    const prompts = provider.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain("dag-audit");
  });

  // 18
  it("dag-audit returns audit workflow instructions", async () => {
    const messages = await provider.getPrompt("dag-audit", {
      subject: "project:api",
      depth: "5",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content.text).toContain("project:api");
    expect(messages[0]!.content.text).toContain("last 5 actions");
    expect(messages[0]!.content.text).toContain("mayros_dag_history");
    expect(messages[0]!.content.text).toContain("mayros_dag_verify");
    expect(messages[0]!.content.text).toContain("mayros_dag_diff");
  });

  // 19
  it("dag-audit defaults depth to 10", async () => {
    const messages = await provider.getPrompt("dag-audit", { subject: "test:sub" });
    expect(messages[0]!.content.text).toContain("last 10 actions");
  });

  // 20
  it("dag-audit throws without subject", async () => {
    await expect(provider.getPrompt("dag-audit", {})).rejects.toThrow("subject");
  });
});
