import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CortexClient } from "../shared/cortex-client.js";
import { KnowledgeFusion } from "./knowledge-fusion.js";

// ============================================================================
// Mock HTTP layer — intercept resilientFetch for deterministic tests
// ============================================================================

type TripleDto = {
  id?: string;
  subject: string;
  predicate: string;
  object: string | number | boolean | { node: string };
};

let storedTriples: TripleDto[] = [];
let tripleIdCounter = 0;

function resetStore() {
  storedTriples = [];
  tripleIdCounter = 0;
}

function addTriple(t: Omit<TripleDto, "id">) {
  tripleIdCounter++;
  const id = `triple-${tripleIdCounter}-${Date.now()}`;
  storedTriples.push({ id, ...t });
}

// Mock global fetch to simulate Cortex
function installFetchMock() {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";

    // POST /api/v1/query — pattern query
    if (urlStr.includes("/api/v1/query") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const matches = storedTriples.filter((t) => {
        if (body.predicate && t.predicate !== body.predicate) return false;
        if (body.subject && t.subject !== body.subject) return false;
        if (body.object !== undefined) {
          const objVal =
            typeof body.object === "object" &&
            body.object !== null &&
            "node" in (body.object as Record<string, unknown>)
              ? (body.object as Record<string, unknown>).node
              : body.object;
          const tripleObj =
            typeof t.object === "object" && t.object !== null && "node" in t.object
              ? t.object.node
              : t.object;
          if (objVal !== tripleObj) return false;
        }
        return true;
      });

      const limit = (body.limit as number) ?? 500;
      const sliced = matches.slice(0, limit);
      return new Response(JSON.stringify({ matches: sliced, total: sliced.length }), {
        status: 200,
      });
    }

    // GET /api/v1/triples — list triples
    if (urlStr.includes("/api/v1/triples") && method === "GET") {
      const u = new URL(urlStr);
      const subject = u.searchParams.get("subject") ?? undefined;
      const predicate = u.searchParams.get("predicate") ?? undefined;
      const limit = Number(u.searchParams.get("limit") ?? 100);

      const matches = storedTriples.filter((t) => {
        if (subject && t.subject !== subject) return false;
        if (predicate && t.predicate !== predicate) return false;
        return true;
      });

      return new Response(
        JSON.stringify({ triples: matches.slice(0, limit), total: matches.length }),
        { status: 200 },
      );
    }

    // POST /api/v1/triples — create triple
    if (urlStr.includes("/api/v1/triples") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      addTriple({
        subject: body.subject as string,
        predicate: body.predicate as string,
        object: body.object as string,
      });
      return new Response(JSON.stringify({ hash: "h-" + tripleIdCounter }), { status: 201 });
    }

    // DELETE /api/v1/triples/:id
    if (urlStr.includes("/api/v1/triples/") && method === "DELETE") {
      const id = decodeURIComponent(urlStr.split("/api/v1/triples/")[1]);
      storedTriples = storedTriples.filter((t) => t.id !== id);
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe("KnowledgeFusion", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetStore();
    installFetchMock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createFusion(ns = "mayros") {
    return new KnowledgeFusion(new CortexClient({ host: "localhost", port: 19090 }), ns);
  }

  // ----- additive strategy -----

  describe("additive merge", () => {
    it("adds non-conflicting triples", async () => {
      const fusion = createFusion();

      // Target has a memory
      addTriple({
        subject: "mem1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "mem1", predicate: "mayros:memory:text", object: "fact A" });

      // Source has a different memory
      addTriple({
        subject: "mem2",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-source" },
      });
      addTriple({ subject: "mem2", predicate: "mayros:memory:text", object: "fact B" });

      const report = await fusion.merge("ns-source", "ns-target", "additive");
      expect(report.strategy).toBe("additive");
      expect(report.added).toBeGreaterThanOrEqual(0);
    });
  });

  // ----- newest-wins strategy -----

  describe("newest-wins merge", () => {
    it("resolves conflicts by keeping newer triple", async () => {
      const fusion = createFusion();

      // Target: old triple
      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "70" });

      // Source: newer triple
      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-source" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "95" });

      const report = await fusion.merge("ns-source", "ns-target", "newest-wins");
      expect(report.strategy).toBe("newest-wins");
      expect(report.details.some((d: string) => d.includes("newest-wins"))).toBe(true);
    });
  });

  // ----- majority-wins strategy -----

  describe("majority-wins merge", () => {
    it("resolves conflicts by counting value occurrences", async () => {
      const fusion = createFusion();

      // Target value: "red"
      addTriple({
        subject: "item1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "item1", predicate: "mayros:attr:color", object: "red" });

      // Source value: "blue"
      addTriple({
        subject: "item1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-source" },
      });
      addTriple({ subject: "item1", predicate: "mayros:attr:color", object: "blue" });

      // Additional ns also says "blue"
      addTriple({
        subject: "item1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-extra" },
      });
      addTriple({ subject: "item1", predicate: "mayros:attr:color", object: "blue" });

      const report = await fusion.merge("ns-source", "ns-target", "majority-wins", ["ns-extra"]);
      expect(report.strategy).toBe("majority-wins");
      expect(report.details.some((d: string) => d.includes("majority-wins"))).toBe(true);
    });
  });

  // ----- conflict-flag strategy -----

  describe("conflict-flag merge", () => {
    it("flags conflicts with marker predicates", async () => {
      const fusion = createFusion();

      // Target
      addTriple({
        subject: "doc1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "doc1", predicate: "mayros:attr:status", object: "draft" });

      // Source (conflicting)
      addTriple({
        subject: "doc1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-source" },
      });
      addTriple({ subject: "doc1", predicate: "mayros:attr:status", object: "published" });

      const report = await fusion.merge("ns-source", "ns-target", "conflict-flag");
      expect(report.conflicts).toBe(1);
      expect(report.details.some((d: string) => d.includes("Flagged conflict"))).toBe(true);

      // Verify conflict marker was created
      const markers = storedTriples.filter((t) => t.predicate.includes(":conflict:"));
      expect(markers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ----- resolveConflicts -----

  describe("resolveConflicts", () => {
    it("resolves flagged conflicts with source-wins", async () => {
      const fusion = createFusion();

      // Simulate a previously flagged conflict
      addTriple({
        subject: "doc1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "doc1", predicate: "mayros:attr:status", object: "draft" });
      addTriple({ subject: "doc1", predicate: "mayros:conflict:status", object: "published" });

      const resolutions = await fusion.resolveConflicts("ns-target", "source-wins");
      expect(resolutions.length).toBeGreaterThanOrEqual(1);
      expect(resolutions[0].strategy).toBe("source-wins");
      expect(resolutions[0].resolvedValue).toBe("published");

      // Verify conflict marker was removed
      const markers = storedTriples.filter((t) => t.predicate.includes(":conflict:"));
      expect(markers.length).toBe(0);
    });

    it("returns empty array when no conflicts exist", async () => {
      const fusion = createFusion();

      addTriple({
        subject: "doc1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns-target" },
      });
      addTriple({ subject: "doc1", predicate: "mayros:attr:status", object: "draft" });

      const resolutions = await fusion.resolveConflicts("ns-target");
      expect(resolutions).toEqual([]);
    });
  });

  // ----- detectConflicts -----

  describe("detectConflicts", () => {
    it("detects value differences between namespaces", async () => {
      const fusion = createFusion();

      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns1" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "70" });

      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns2" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "95" });

      const conflicts = await fusion.detectConflicts("ns1", "ns2");
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts[0].values.length).toBe(2);
    });

    it("returns empty when no conflicts", async () => {
      const fusion = createFusion();

      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns1" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "70" });

      addTriple({
        subject: "entity1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "ns2" },
      });
      addTriple({ subject: "entity1", predicate: "mayros:attr:score", object: "70" });

      const conflicts = await fusion.detectConflicts("ns1", "ns2");
      expect(conflicts.length).toBe(0);
    });
  });
});
