import { describe, it, expect, beforeEach } from "vitest";
import { LspCortexBackend } from "./lsp-cortex-backend.js";
import type { CortexClientLike } from "../shared/cortex-client.js";
import type { LspDiagnostic } from "./lsp-protocol.js";

// ============================================================================
// Mock CortexClient
// ============================================================================

function createMockClient(): CortexClientLike & {
  _triples: Map<string, Array<{ id: string; subject: string; predicate: string; object: string }>>;
} {
  let nextId = 1;
  const triples = new Map<
    string,
    Array<{ id: string; subject: string; predicate: string; object: string }>
  >();

  return {
    _triples: triples,

    async createTriple(req) {
      const id = String(nextId++);
      const key = `${req.subject}::${req.predicate}`;
      const existing = triples.get(key) ?? [];
      const objectStr =
        typeof req.object === "object" && req.object !== null && "node" in req.object
          ? JSON.stringify(req.object)
          : String(req.object);
      existing.push({
        id,
        subject: req.subject,
        predicate: req.predicate,
        object: objectStr,
      });
      triples.set(key, existing);
      return { id, subject: req.subject, predicate: req.predicate, object: objectStr };
    },

    async listTriples(query) {
      const results: Array<{ id: string; subject: string; predicate: string; object: string }> = [];
      for (const [, arr] of triples) {
        for (const t of arr) {
          if (query.subject && t.subject !== query.subject) continue;
          if (query.predicate && t.predicate !== query.predicate) continue;
          results.push(t);
        }
      }
      const limit = query.limit ?? 100;
      return { triples: results.slice(0, limit), total: results.length };
    },

    async patternQuery(req) {
      const results: Array<{ id: string; subject: string; predicate: string; object: string }> = [];
      for (const [, arr] of triples) {
        for (const t of arr) {
          if (req.subject && t.subject !== req.subject) continue;
          if (req.predicate && t.predicate !== req.predicate) continue;
          if (req.object !== undefined) {
            const reqObj =
              typeof req.object === "object" && req.object !== null
                ? JSON.stringify(req.object)
                : String(req.object);
            if (t.object !== reqObj) continue;
          }
          results.push(t);
        }
      }
      const limit = req.limit ?? 100;
      return { matches: results.slice(0, limit), total: results.length };
    },

    async deleteTriple(id) {
      for (const [key, arr] of triples) {
        const idx = arr.findIndex((t) => t.id === id);
        if (idx >= 0) {
          arr.splice(idx, 1);
          if (arr.length === 0) triples.delete(key);
          return;
        }
      }
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("LspCortexBackend", () => {
  let client: ReturnType<typeof createMockClient>;
  let backend: LspCortexBackend;

  beforeEach(() => {
    client = createMockClient();
    backend = new LspCortexBackend(client, "test");
  });

  const sampleDiagnostic: LspDiagnostic = {
    range: { start: { line: 10, character: 5 }, end: { line: 10, character: 20 } },
    severity: 1,
    code: "TS2345",
    source: "typescript",
    message: "Argument of type 'string' is not assignable",
  };

  // ---------- storeDiagnostics ----------

  it("storeDiagnostics creates correct triples", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    const messageTriples = await client.listTriples({
      predicate: "test:lsp:message",
    });
    expect(messageTriples.triples.length).toBeGreaterThanOrEqual(1);
    expect(messageTriples.triples[0].object).toContain("not assignable");
  });

  it("storeDiagnostics stores severity", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    const severityTriples = await client.listTriples({
      predicate: "test:lsp:severity",
    });
    expect(severityTriples.triples.length).toBeGreaterThanOrEqual(1);
    expect(severityTriples.triples[0].object).toBe("error");
  });

  it("storeDiagnostics stores source", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    const sourceTriples = await client.listTriples({
      predicate: "test:lsp:source",
    });
    expect(sourceTriples.triples.length).toBeGreaterThanOrEqual(1);
    expect(sourceTriples.triples[0].object).toBe("typescript");
  });

  it("storeDiagnostics stores range as JSON", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    const rangeTriples = await client.listTriples({
      predicate: "test:lsp:range",
    });
    expect(rangeTriples.triples.length).toBeGreaterThanOrEqual(1);
    const range = JSON.parse(rangeTriples.triples[0].object);
    expect(range.start.line).toBe(10);
    expect(range.start.character).toBe(5);
  });

  // ---------- getDiagnostics ----------

  it("getDiagnostics reconstructs diagnostics from triples", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    const diagnostics = await backend.getDiagnostics();
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].diagnostic.message).toContain("not assignable");
    expect(diagnostics[0].source).toBe("typescript");
  });

  it("getDiagnostics filters by uri", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");
    await backend.storeDiagnostics(
      "file:///src/other.ts",
      [{ ...sampleDiagnostic, message: "other error" }],
      "typescript",
    );

    const diagnostics = await backend.getDiagnostics("file:///src/index.ts");
    expect(diagnostics.every((d) => d.uri.includes("index.ts"))).toBe(true);
  });

  it("getDiagnostics returns empty for no diagnostics", async () => {
    const diagnostics = await backend.getDiagnostics();
    expect(diagnostics).toHaveLength(0);
  });

  // ---------- clearDiagnostics ----------

  it("clearDiagnostics deletes file diagnostics", async () => {
    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic], "typescript");

    await backend.clearDiagnostics("file:///src/index.ts");

    const diagnostics = await backend.getDiagnostics("file:///src/index.ts");
    expect(diagnostics).toHaveLength(0);
  });

  // ---------- Multiple diagnostics ----------

  it("stores multiple diagnostics per file", async () => {
    const diag2: LspDiagnostic = {
      range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
      severity: 2,
      message: "Variable is unused",
    };

    await backend.storeDiagnostics("file:///src/index.ts", [sampleDiagnostic, diag2], "typescript");

    const diagnostics = await backend.getDiagnostics();
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  // ---------- lookupDefinition ----------

  it("lookupDefinition queries code-indexer triples", async () => {
    // Simulate code-indexer triples
    await client.createTriple({
      subject: "test:code:function:src/utils.ts#formatDate",
      predicate: "test:code:name",
      object: "formatDate",
    });
    await client.createTriple({
      subject: "test:code:function:src/utils.ts#formatDate",
      predicate: "test:code:path",
      object: "src/utils.ts",
    });
    await client.createTriple({
      subject: "test:code:function:src/utils.ts#formatDate",
      predicate: "test:code:line",
      object: "42",
    });
    await client.createTriple({
      subject: "test:code:function:src/utils.ts#formatDate",
      predicate: "test:code:type",
      object: "function",
    });

    const result = await backend.lookupDefinition("formatDate");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("formatDate");
    expect(result!.path).toBe("src/utils.ts");
    expect(result!.line).toBe(42);
    expect(result!.type).toBe("function");
  });

  it("lookupDefinition returns null for unknown symbol", async () => {
    const result = await backend.lookupDefinition("unknownSymbol");
    expect(result).toBeNull();
  });

  // ---------- lookupSymbol ----------

  it("lookupSymbol returns type info", async () => {
    await client.createTriple({
      subject: "test:code:class:src/models.ts#User",
      predicate: "test:code:name",
      object: "User",
    });
    await client.createTriple({
      subject: "test:code:class:src/models.ts#User",
      predicate: "test:code:path",
      object: "src/models.ts",
    });
    await client.createTriple({
      subject: "test:code:class:src/models.ts#User",
      predicate: "test:code:line",
      object: "5",
    });
    await client.createTriple({
      subject: "test:code:class:src/models.ts#User",
      predicate: "test:code:type",
      object: "class",
    });

    const result = await backend.lookupSymbol("User");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("User");
    expect(result!.type).toBe("class");
    expect(result!.path).toBe("src/models.ts");
    expect(result!.line).toBe(5);
  });

  it("lookupSymbol returns null for unknown symbol", async () => {
    const result = await backend.lookupSymbol("unknownSymbol");
    expect(result).toBeNull();
  });
});
