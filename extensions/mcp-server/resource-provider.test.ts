import { describe, it, expect, beforeEach } from "vitest";
import {
  McpResourceProvider,
  type ResourceDataSources,
  type AgentInfo,
} from "./resource-provider.js";
import { ErrorCodes } from "./protocol.js";

// ── Mock data ─────────────────────────────────────────────────────────

const MOCK_AGENTS: AgentInfo[] = [
  {
    id: "coder",
    name: "Coder",
    model: "anthropic/claude-sonnet-4-20250514",
    isDefault: true,
    identity: "You are a coding assistant. Focus on clean, testable code.",
    origin: "project",
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    isDefault: false,
    identity: "You are a code reviewer. Focus on quality and security.",
    origin: "user",
  },
];

function createMockSources(): ResourceDataSources {
  return {
    listAgents: () => MOCK_AGENTS,
    getAgent: (id) => MOCK_AGENTS.find((a) => a.id === id) ?? null,
    listConventions: async () => [
      {
        id: "c1",
        text: "Use TypeScript strict mode",
        category: "tooling",
        source: "auto-detected",
        confidence: 0.9,
        status: "active",
        createdAt: "2025-01-01",
      },
    ],
    getConvention: async (id) =>
      id === "c1"
        ? {
            id: "c1",
            text: "Use TypeScript strict mode",
            category: "tooling",
            source: "auto-detected",
            confidence: 0.9,
            status: "active",
            createdAt: "2025-01-01",
          }
        : null,
    listRules: async () => [
      {
        id: "r1",
        content: "Always run tests before committing",
        scope: "global",
        priority: 100,
        source: "manual",
        enabled: true,
      },
    ],
    getRule: async (id) =>
      id === "r1"
        ? {
            id: "r1",
            content: "Always run tests before committing",
            scope: "global",
            priority: 100,
            source: "manual",
            enabled: true,
          }
        : null,
    getGraphStats: async () => ({
      tripleCount: 1500,
      subjectCount: 200,
      predicateCount: 45,
    }),
    listGraphSubjects: async () => ["mayros:project:convention:c1", "mayros:rule:global:r1"],
  };
}

describe("McpResourceProvider", () => {
  let provider: McpResourceProvider;

  beforeEach(() => {
    provider = new McpResourceProvider(createMockSources());
  });

  // 1
  it("listResources includes static and dynamic resources", async () => {
    const resources = await provider.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("mayros:///agents");
    expect(uris).toContain("mayros:///project/conventions");
    expect(uris).toContain("mayros:///rules");
    expect(uris).toContain("mayros:///graph/stats");
    expect(uris).toContain("mayros:///graph/subjects");
    // Dynamic agent resources
    expect(uris).toContain("mayros:///agents/coder");
    expect(uris).toContain("mayros:///agents/reviewer");
  });

  // 2
  it("readResource agents list returns JSON summary", async () => {
    const result = await provider.readResource("mayros:///agents");
    expect(result.mimeType).toBe("application/json");
    const data = JSON.parse(result.text!);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("coder");
  });

  // 3
  it("readResource agent by id returns identity markdown", async () => {
    const result = await provider.readResource("mayros:///agents/coder");
    expect(result.mimeType).toBe("text/markdown");
    expect(result.text).toContain("coding assistant");
  });

  // 4
  it("readResource throws for unknown agent", async () => {
    await expect(provider.readResource("mayros:///agents/unknown")).rejects.toThrow();
  });

  // 5
  it("readResource conventions returns list", async () => {
    const result = await provider.readResource("mayros:///project/conventions");
    const data = JSON.parse(result.text!);
    expect(data).toHaveLength(1);
    expect(data[0].text).toContain("TypeScript strict");
  });

  // 6
  it("readResource single convention by id", async () => {
    const result = await provider.readResource("mayros:///project/conventions/c1");
    const data = JSON.parse(result.text!);
    expect(data.id).toBe("c1");
  });

  // 7
  it("readResource throws for unknown convention", async () => {
    await expect(
      provider.readResource("mayros:///project/conventions/nonexistent"),
    ).rejects.toThrow();
  });

  // 8
  it("readResource rules returns list", async () => {
    const result = await provider.readResource("mayros:///rules");
    const data = JSON.parse(result.text!);
    expect(data).toHaveLength(1);
    expect(data[0].content).toContain("tests");
  });

  // 9
  it("readResource single rule by id", async () => {
    const result = await provider.readResource("mayros:///rules/r1");
    const data = JSON.parse(result.text!);
    expect(data.id).toBe("r1");
  });

  // 10
  it("readResource graph stats", async () => {
    const result = await provider.readResource("mayros:///graph/stats");
    const data = JSON.parse(result.text!);
    expect(data.tripleCount).toBe(1500);
    expect(data.subjectCount).toBe(200);
  });

  // 11
  it("readResource graph subjects", async () => {
    const result = await provider.readResource("mayros:///graph/subjects");
    const data = JSON.parse(result.text!);
    expect(data).toHaveLength(2);
    expect(data[0]).toContain("convention");
  });

  // 12
  it("readResource throws for completely unknown URI", async () => {
    await expect(provider.readResource("mayros:///unknown/path")).rejects.toThrow();
  });

  // 13
  it("updateSources replaces data sources", async () => {
    provider.updateSources({
      listAgents: () => [],
    });
    const resources = await provider.listResources();
    const agentUris = resources.filter((r) => r.uri.startsWith("mayros:///agents/"));
    expect(agentUris).toHaveLength(0);
  });
});
