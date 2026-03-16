import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PulseScheduler } from "./pulse.js";
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
      addTriple({
        subject: body.subject as string,
        predicate: body.predicate as string,
        object: body.object as string,
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

describe("PulseScheduler", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let scheduler: PulseScheduler;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    scheduler = new PulseScheduler(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- register -----

  describe("register", () => {
    it("stores registration", async () => {
      await scheduler.register("agent-1", "venture-1", {
        interval: "5m",
        triggers: ["timer"],
      });
      const reg = await scheduler.getRegistration("agent-1");
      expect(reg).not.toBeNull();
      expect(reg!.agentId).toBe("agent-1");
      expect(reg!.ventureId).toBe("venture-1");
      expect(reg!.config.interval).toBe("5m");
    });

    it("rejects empty agent ID", async () => {
      await expect(
        scheduler.register("", "v", { interval: "5m", triggers: ["timer"] }),
      ).rejects.toThrow("Agent ID is required");
    });

    it("rejects empty venture ID", async () => {
      await expect(
        scheduler.register("a", "", { interval: "5m", triggers: ["timer"] }),
      ).rejects.toThrow("Venture ID is required");
    });

    it("rejects empty interval", async () => {
      await expect(
        scheduler.register("a", "v", { interval: "  ", triggers: ["timer"] }),
      ).rejects.toThrow("Pulse interval is required");
    });
  });

  // ----- unregister -----

  describe("unregister", () => {
    it("removes registration", async () => {
      await scheduler.register("agent-1", "v", { interval: "5m", triggers: ["timer"] });
      await scheduler.unregister("agent-1");
      const reg = await scheduler.getRegistration("agent-1");
      expect(reg).toBeNull();
    });
  });

  // ----- getRegistration -----

  describe("getRegistration", () => {
    it("returns config for registered agent", async () => {
      await scheduler.register("agent-1", "v", {
        interval: "10m",
        triggers: ["timer", "mention"],
        fuelLimit: 100,
      });
      const reg = await scheduler.getRegistration("agent-1");
      expect(reg).not.toBeNull();
      expect(reg!.config.triggers).toEqual(["timer", "mention"]);
      expect(reg!.config.fuelLimit).toBe(100);
    });

    it("returns null for unregistered agent", async () => {
      const reg = await scheduler.getRegistration("nobody");
      expect(reg).toBeNull();
    });
  });

  // ----- trigger -----

  describe("trigger", () => {
    it("creates new pulse", async () => {
      const pulse = await scheduler.trigger("agent-1", "v", "timer");
      expect(pulse.agentId).toBe("agent-1");
      expect(pulse.status).toBe("queued");
      expect(pulse.trigger).toBe("timer");
      expect(pulse.coalescedCount).toBe(0);
    });

    it("coalesces when queued pulse exists", async () => {
      // Register with coalescing enabled (default)
      await scheduler.register("agent-1", "v", { interval: "5m", triggers: ["timer"] });

      const first = await scheduler.trigger("agent-1", "v", "timer");
      const second = await scheduler.trigger("agent-1", "v", "mention", { extra: "data" });

      // Second trigger should coalesce into first
      expect(second.id).toBe(first.id);
      expect(second.coalescedCount).toBe(1);
    });
  });

  // ----- claim -----

  describe("claim", () => {
    it("claims queued pulse", async () => {
      const pulse = await scheduler.trigger("agent-1", "v", "timer");
      const claimed = await scheduler.claim(pulse.id, "run-1");
      expect(claimed.status).toBe("claimed");
      expect(claimed.claimedAt).toBeTruthy();
    });

    it("rejects non-queued pulse", async () => {
      const pulse = await scheduler.trigger("agent-1", "v", "timer");
      await scheduler.claim(pulse.id, "run-1");
      await expect(scheduler.claim(pulse.id, "run-2")).rejects.toThrow("not queued");
    });
  });

  // ----- finish / fail -----

  describe("finish", () => {
    it("updates status to finished", async () => {
      const pulse = await scheduler.trigger("agent-1", "v", "timer");
      await scheduler.claim(pulse.id, "run-1");
      await scheduler.finish(pulse.id, "run-1");
      const after = await scheduler.getPulse(pulse.id);
      expect(after!.status).toBe("finished");
      expect(after!.finishedAt).toBeTruthy();
    });
  });

  describe("fail", () => {
    it("updates status to failed", async () => {
      const pulse = await scheduler.trigger("agent-1", "v", "timer");
      await scheduler.claim(pulse.id, "run-1");
      await scheduler.fail(pulse.id, "run-1", "timeout");
      const after = await scheduler.getPulse(pulse.id);
      expect(after!.status).toBe("failed");
    });
  });

  // ----- listQueued -----

  describe("listQueued", () => {
    it("returns only queued pulses", async () => {
      const p1 = await scheduler.trigger("agent-1", "v", "timer");
      const p2 = await scheduler.trigger("agent-2", "v", "timer");
      // Claim p2 so it is no longer queued
      await scheduler.claim(p2.id, "run-1");

      const queued = await scheduler.listQueued("agent-1");
      expect(queued).toHaveLength(1);
      expect(queued[0].id).toBe(p1.id);
    });
  });
});
