import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MissionCommentService } from "./mission-comments.js";
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

describe("MissionCommentService", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let svc: MissionCommentService;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    svc = new MissionCommentService(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- add -----

  describe("add", () => {
    it("creates comment with correct fields", async () => {
      const c = await svc.add("m1", "agent-a", "Looks good");
      expect(c.missionId).toBe("m1");
      expect(c.author).toBe("agent-a");
      expect(c.content).toBe("Looks good");
      expect(c.id).toBeTruthy();
      expect(c.createdAt).toBeTruthy();
    });

    it("rejects empty mission ID", async () => {
      await expect(svc.add("", "agent-a", "text")).rejects.toThrow("Mission ID is required");
    });

    it("rejects empty author", async () => {
      await expect(svc.add("m1", "", "text")).rejects.toThrow("Author is required");
    });

    it("rejects empty content", async () => {
      await expect(svc.add("m1", "agent-a", "  ")).rejects.toThrow("Comment content is required");
    });
  });

  // ----- list -----

  describe("list", () => {
    it("returns comments ordered by createdAt", async () => {
      await svc.add("m1", "agent-a", "First comment");
      await svc.add("m1", "agent-b", "Second comment");
      const comments = await svc.list("m1");
      expect(comments).toHaveLength(2);
      expect(comments[0].content).toBe("First comment");
      expect(comments[1].content).toBe("Second comment");
    });

    it("returns empty array for no comments", async () => {
      const comments = await svc.list("nonexistent");
      expect(comments).toHaveLength(0);
    });
  });

  // ----- count -----

  describe("count", () => {
    it("returns count of comments for a mission", async () => {
      await svc.add("m1", "agent-a", "First");
      await svc.add("m1", "agent-b", "Second");
      await svc.add("m2", "agent-a", "Different mission");
      const count = await svc.count("m1");
      expect(count).toBe(2);
    });

    it("returns 0 for mission with no comments", async () => {
      const count = await svc.count("empty");
      expect(count).toBe(0);
    });
  });
});
