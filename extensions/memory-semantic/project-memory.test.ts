import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProjectMemory,
  detectProjectKnowledge,
  extractAssistantFinding,
  formatConventionsForPrompt,
  formatFindingsForPrompt,
} from "./project-memory.js";
import type {
  CortexClient,
  CreateTripleRequest,
  TripleDto,
  ListTriplesResponse,
  PatternQueryResponse,
} from "../shared/cortex-client.js";

// ============================================================================
// Mock client
// ============================================================================

function createMockClient() {
  const stored: CreateTripleRequest[] = [];

  const client = {
    createTriple: vi.fn(async (req: CreateTripleRequest) => {
      stored.push(req);
      return { ...req, id: `id-${stored.length}`, created_at: new Date().toISOString() };
    }),
    listTriples: vi.fn(
      async (): Promise<ListTriplesResponse> => ({
        triples: [],
        total: 0,
      }),
    ),
    patternQuery: vi.fn(
      async (): Promise<PatternQueryResponse> => ({
        matches: [],
        total: 0,
      }),
    ),
    deleteTriple: vi.fn(),
    isHealthy: vi.fn(async () => true),
  } as unknown as CortexClient;

  return { client, stored };
}

// ============================================================================
// detectProjectKnowledge
// ============================================================================

describe("detectProjectKnowledge", () => {
  it("detects convention with 'we always' pattern", () => {
    const result = detectProjectKnowledge("We always use strict TypeScript");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("convention");
  });

  it("detects naming convention", () => {
    const result = detectProjectKnowledge("The naming pattern for files is kebab-case");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("convention");
  });

  it("detects decision", () => {
    const result = detectProjectKnowledge("Decided that all modules should be ESM only");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("decision");
  });

  it("returns null for short text", () => {
    expect(detectProjectKnowledge("hi")).toBeNull();
  });

  it("returns null for text over 500 chars", () => {
    expect(detectProjectKnowledge("a".repeat(501))).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(detectProjectKnowledge("The weather is nice today")).toBeNull();
  });
});

// ============================================================================
// extractAssistantFinding
// ============================================================================

describe("extractAssistantFinding", () => {
  it("extracts file change finding", () => {
    const result = extractAssistantFinding("I've created the new auth module in src/auth.ts");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("change");
  });

  it("extracts bug finding", () => {
    const result = extractAssistantFinding(
      "The bug was caused by a missing null check in login.ts",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("finding");
  });

  it("returns null for short text", () => {
    expect(extractAssistantFinding("done")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(extractAssistantFinding("Here is a summary of the code")).toBeNull();
  });
});

// ============================================================================
// formatConventionsForPrompt
// ============================================================================

describe("formatConventionsForPrompt", () => {
  it("returns empty string for no conventions", () => {
    expect(formatConventionsForPrompt([])).toBe("");
  });

  it("wraps conventions in tags", () => {
    const result = formatConventionsForPrompt([
      {
        id: "1",
        text: "Use strict mode",
        category: "style",
        source: "user",
        confidence: 0.9,
        context: "",
        status: "active",
        createdAt: "",
      },
    ]);
    expect(result).toContain("<project-conventions>");
    expect(result).toContain("Use strict mode");
  });
});

// ============================================================================
// formatFindingsForPrompt
// ============================================================================

describe("formatFindingsForPrompt", () => {
  it("returns empty string for no findings", () => {
    expect(formatFindingsForPrompt([])).toBe("");
  });

  it("wraps findings in tags with untrusted warning", () => {
    const result = formatFindingsForPrompt([
      { id: "1", type: "change", text: "Added auth module", createdAt: "" },
    ]);
    expect(result).toContain("<session-context>");
    expect(result).toContain("untrusted");
    expect(result).toContain("Added auth module");
  });
});

// ============================================================================
// ProjectMemory.ingestMayrosMd
// ============================================================================

describe("ProjectMemory.ingestMayrosMd", () => {
  let mock: ReturnType<typeof createMockClient>;
  let pm: ProjectMemory;

  beforeEach(() => {
    mock = createMockClient();
    pm = new ProjectMemory(mock.client, "test");
  });

  it("returns 0 for empty content", async () => {
    const count = await pm.ingestMayrosMd("");
    expect(count).toBe(0);
    expect(mock.client.createTriple).not.toHaveBeenCalled();
  });

  it("extracts section headings", async () => {
    const content = "## Build & Test\n\nSome content\n\n## Security\n\nMore content";
    const count = await pm.ingestMayrosMd(content);
    expect(count).toBeGreaterThanOrEqual(2);

    const sectionTriples = mock.stored.filter((t) => t.predicate.includes("mayros:section"));
    expect(sectionTriples.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts build commands", async () => {
    const content =
      "## Build\n\n- **Install**: `pnpm install`\n- **Build**: `pnpm build`\n- **Tests**: `pnpm test`";
    const count = await pm.ingestMayrosMd(content);
    expect(count).toBeGreaterThanOrEqual(3);

    const buildTriples = mock.stored.filter((t) => t.predicate.includes("build_command"));
    expect(buildTriples.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts key files from tables", async () => {
    const content =
      "## Key Files\n\n| File | Purpose |\n| --- | --- |\n| `src/index.ts` | Main entry point |\n| `src/config.ts` | Config loader |";
    const count = await pm.ingestMayrosMd(content);
    expect(count).toBeGreaterThanOrEqual(2);

    const fileTriples = mock.stored.filter((t) => t.predicate.includes("key_file"));
    expect(fileTriples.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts coding conventions from bullets", async () => {
    const content =
      "## Coding Conventions\n\n- TypeScript ESM, strict typing\n- Always use vitest for testing\n- Never use any type";
    const count = await pm.ingestMayrosMd(content);

    const convTriples = mock.stored.filter((t) => t.predicate.includes("convention"));
    expect(convTriples.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates triples by subject+predicate", async () => {
    const content = "## Section\n## Section\n## Section";
    const count = await pm.ingestMayrosMd(content);
    expect(count).toBe(1);
  });

  it("handles realistic MAYROS.md content", async () => {
    const content = [
      "# MAYROS v0.1.0",
      "",
      "## Build & Test",
      "",
      "- **Install**: `pnpm install`",
      "- **Build**: `pnpm build`",
      "- **Tests**: `pnpm test`",
      "",
      "## Coding Conventions",
      "",
      "- TypeScript ESM, strict typing, no `any`",
      "- Tests: colocated `*.test.ts`, vitest",
      "- Prefer using existing patterns from the codebase",
      "",
      "## Key Files",
      "",
      "| File | Purpose |",
      "| --- | --- |",
      "| `src/index.ts` | Main entry |",
      "| `src/config.ts` | Config |",
    ].join("\n");

    const count = await pm.ingestMayrosMd(content);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(mock.client.createTriple).toHaveBeenCalled();
  });
});
