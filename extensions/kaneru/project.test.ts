import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProjectManager } from "./project.js";
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

function installFetchMock() {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";

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

    if (urlStr.includes("/api/v1/triples") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      tripleIdCounter++;
      storedTriples.push({
        id: `triple-${tripleIdCounter}`,
        subject: body.subject as string,
        predicate: body.predicate as string,
        object: body.object as string | { node: string },
      });
      return new Response(JSON.stringify({ hash: "h-" + tripleIdCounter }), { status: 201 });
    }

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

describe("ProjectManager", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let mgr: ProjectManager;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    mgr = new ProjectManager(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- create -----

  describe("create", () => {
    it("creates project with correct fields", async () => {
      const p = await mgr.create({
        name: "Alpha",
        ventureId: "v1",
        owner: "agent-a",
        targetDate: "2026-06-01",
        category: "backend",
      });
      expect(p.name).toBe("Alpha");
      expect(p.ventureId).toBe("v1");
      expect(p.owner).toBe("agent-a");
      expect(p.status).toBe("planning");
      expect(p.targetDate).toBe("2026-06-01");
      expect(p.category).toBe("backend");
      expect(p.id).toBeTruthy();
      expect(p.createdAt).toBeTruthy();
      expect(p.updatedAt).toBeTruthy();
    });

    it("uses defaults for optional fields", async () => {
      const p = await mgr.create({ name: "Beta", ventureId: "v1" });
      expect(p.owner).toBeNull();
      expect(p.targetDate).toBeNull();
      expect(p.category).toBe("general");
      expect(p.description).toBe("");
    });

    it("rejects empty project name", async () => {
      await expect(mgr.create({ name: "", ventureId: "v1" })).rejects.toThrow(
        "Project name is required",
      );
    });

    it("rejects empty venture ID", async () => {
      await expect(mgr.create({ name: "Test", ventureId: "" })).rejects.toThrow(
        "Venture ID is required",
      );
    });
  });

  // ----- get -----

  describe("get", () => {
    it("returns project by ID", async () => {
      const created = await mgr.create({ name: "Alpha", ventureId: "v1" });
      const fetched = await mgr.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("Alpha");
      expect(fetched!.id).toBe(created.id);
    });

    it("returns null for missing project", async () => {
      const result = await mgr.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ----- list -----

  describe("list", () => {
    it("returns projects for a venture", async () => {
      await mgr.create({ name: "P1", ventureId: "v1" });
      await mgr.create({ name: "P2", ventureId: "v1" });
      await mgr.create({ name: "P3", ventureId: "v2" });
      const projects = await mgr.list("v1");
      expect(projects).toHaveLength(2);
      const names = projects.map((p) => p.name).sort();
      expect(names).toEqual(["P1", "P2"]);
    });
  });

  // ----- update -----

  describe("update", () => {
    it("updates project fields", async () => {
      const created = await mgr.create({ name: "Alpha", ventureId: "v1" });
      const updated = await mgr.update(created.id, { name: "Alpha v2", status: "active" });
      expect(updated.name).toBe("Alpha v2");
      expect(updated.status).toBe("active");
    });

    it("throws for missing project", async () => {
      await expect(mgr.update("nonexistent", { name: "X" })).rejects.toThrow(
        "Project not found: nonexistent",
      );
    });
  });

  // ----- complete -----

  describe("complete", () => {
    it("sets status to completed", async () => {
      const created = await mgr.create({ name: "Alpha", ventureId: "v1" });
      await mgr.complete(created.id);
      const fetched = await mgr.get(created.id);
      expect(fetched!.status).toBe("completed");
    });
  });
});
