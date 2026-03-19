import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DojoService } from "./dojo.js";
import { VentureManager } from "./venture.js";
import { ChainManager } from "./chain.js";
import { DirectiveManager } from "./directives.js";
import type { CortexClient as CortexClientType } from "../shared/cortex-client.js";

// ============================================================================
// Mock HTTP layer — intercept fetch for deterministic tests
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

describe("DojoService", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let ventureMgr: VentureManager;
  let chainMgr: ChainManager;
  let directiveMgr: DirectiveManager;
  let dojo: DojoService;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    ventureMgr = new VentureManager(client, "test");
    chainMgr = new ChainManager(client, "test");
    directiveMgr = new DirectiveManager(client, "test");
    dojo = new DojoService(client, "test", ventureMgr, chainMgr, directiveMgr);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- listTemplates -----

  describe("listTemplates", () => {
    it("returns 3 bundled templates", () => {
      const templates = dojo.listTemplates();
      expect(templates).toHaveLength(3);
    });

    it("includes expected template IDs", () => {
      const ids = dojo.listTemplates().map((t) => t.id);
      expect(ids).toContain("security-audit");
      expect(ids).toContain("content-pipeline");
      expect(ids).toContain("devops-squad");
    });
  });

  // ----- getTemplate -----

  describe("getTemplate", () => {
    it("finds template by ID", () => {
      const template = dojo.getTemplate("security-audit");
      expect(template).not.toBeNull();
      expect(template!.name).toBe("Security Audit Squad");
    });

    it("returns null for missing template", () => {
      const template = dojo.getTemplate("nonexistent");
      expect(template).toBeNull();
    });
  });

  // ----- preview -----

  describe("preview", () => {
    it("returns formatted text with agents and directives", () => {
      const text = dojo.preview("security-audit");
      expect(text).toContain("Security Audit Squad");
      expect(text).toContain("Agents (3):");
      expect(text).toContain("scanner [Vulnerability Scanner]");
      expect(text).toContain("Directives (6):");
      expect(text).toContain("[strategic] Maintain secure codebase");
    });

    it("returns error message for unknown template", () => {
      const text = dojo.preview("nonexistent");
      expect(text).toBe("Template not found: nonexistent");
    });
  });

  // ----- install -----

  describe("install", () => {
    it("creates venture, deploys agents, creates directives", async () => {
      const result = await dojo.install("security-audit", "My Sec Team");
      expect(result.ventureName).toBe("My Sec Team");
      expect(result.prefix).toBe("SEC");
      expect(result.agentsDeployed).toBe(3);
      expect(result.directivesCreated).toBe(6);
      expect(result.templateId).toBe("security-audit");
      expect(result.ventureId).toBeTruthy();
    });

    it("creates venture with template fuel limit", async () => {
      const result = await dojo.install("devops-squad", "Ops Team");
      expect(result.agentsDeployed).toBe(3);
      expect(result.directivesCreated).toBe(6);
      expect(result.prefix).toBe("OPS");
    });

    it("throws for unknown template", async () => {
      await expect(dojo.install("nonexistent", "Nope")).rejects.toThrow(
        "Template not found: nonexistent",
      );
    });
  });
});
