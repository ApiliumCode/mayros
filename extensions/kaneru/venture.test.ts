import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VentureManager } from "./venture.js";
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

describe("VentureManager", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let mgr: VentureManager;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    mgr = new VentureManager(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- create -----

  describe("create", () => {
    it("creates venture with correct fields", async () => {
      const v = await mgr.create({
        name: "Alpha",
        directive: "Build stuff",
        prefix: "alp",
        fuelLimit: 5000,
      });
      expect(v.name).toBe("Alpha");
      expect(v.directive).toBe("Build stuff");
      expect(v.fuelLimit).toBe(5000);
      expect(v.status).toBe("active");
      expect(v.missionCounter).toBe(0);
      expect(v.createdAt).toBeTruthy();
      expect(v.updatedAt).toBeTruthy();
    });

    it("uppercases the prefix", async () => {
      const v = await mgr.create({ name: "Beta", directive: "d", prefix: "beta" });
      expect(v.prefix).toBe("BETA");
    });

    it("rejects empty name", async () => {
      await expect(mgr.create({ name: "", directive: "d", prefix: "X" })).rejects.toThrow(
        "Venture name is required",
      );
    });

    it("rejects empty prefix", async () => {
      await expect(mgr.create({ name: "V", directive: "d", prefix: "  " })).rejects.toThrow(
        "Venture prefix is required",
      );
    });

    it("rejects prefix longer than 10 chars", async () => {
      await expect(
        mgr.create({ name: "V", directive: "d", prefix: "TOOLONGPREFIX" }),
      ).rejects.toThrow("10 characters or less");
    });

    it("rejects duplicate prefix", async () => {
      await mgr.create({ name: "First", directive: "d", prefix: "DUP" });
      await expect(mgr.create({ name: "Second", directive: "d", prefix: "dup" })).rejects.toThrow(
        "already in use",
      );
    });
  });

  // ----- get -----

  describe("get", () => {
    it("returns venture by ID", async () => {
      const created = await mgr.create({ name: "GetMe", directive: "d", prefix: "GM" });
      const found = await mgr.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("GetMe");
      expect(found!.id).toBe(created.id);
    });

    it("returns null for missing ID", async () => {
      const found = await mgr.get("nonexistent");
      expect(found).toBeNull();
    });
  });

  // ----- list -----

  describe("list", () => {
    it("returns empty array when none exist", async () => {
      const result = await mgr.list();
      expect(result).toEqual([]);
    });

    it("returns created ventures", async () => {
      await mgr.create({ name: "A", directive: "d", prefix: "AA" });
      await mgr.create({ name: "B", directive: "d", prefix: "BB" });
      const result = await mgr.list();
      expect(result).toHaveLength(2);
      expect(result.map((v) => v.name).sort()).toEqual(["A", "B"]);
    });
  });

  // ----- update -----

  describe("update", () => {
    it("updates fields", async () => {
      const v = await mgr.create({ name: "Old", directive: "d", prefix: "UPD" });
      const updated = await mgr.update(v.id, { name: "New", fuelLimit: 9999 });
      expect(updated.name).toBe("New");
      expect(updated.fuelLimit).toBe(9999);
    });

    it("throws for missing venture", async () => {
      await expect(mgr.update("nope", { name: "X" })).rejects.toThrow("Venture not found");
    });
  });

  // ----- archive -----

  describe("archive", () => {
    it("sets status to archived", async () => {
      const v = await mgr.create({ name: "ToArchive", directive: "d", prefix: "ARC" });
      await mgr.archive(v.id);
      const archived = await mgr.get(v.id);
      expect(archived!.status).toBe("archived");
    });
  });

  // ----- nextMissionId -----

  describe("nextMissionId", () => {
    it("increments counter and returns formatted ID", async () => {
      const v = await mgr.create({ name: "Counter", directive: "d", prefix: "cnt" });
      const first = await mgr.nextMissionId(v.id);
      expect(first.counter).toBe(1);
      expect(first.identifier).toBe("CNT-1");

      const second = await mgr.nextMissionId(v.id);
      expect(second.counter).toBe(2);
      expect(second.identifier).toBe("CNT-2");
    });
  });
});
