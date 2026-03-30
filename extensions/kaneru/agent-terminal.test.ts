import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentTerminalService } from "./agent-terminal.js";
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

describe("AgentTerminalService", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let svc: AgentTerminalService;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    svc = new AgentTerminalService(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- isEnabled -----

  describe("isEnabled", () => {
    it("returns true by default", () => {
      expect(svc.isEnabled()).toBe(true);
    });

    it("returns config value when disabled", () => {
      const disabled = new AgentTerminalService(client, "test", { enabled: false });
      expect(disabled.isEnabled()).toBe(false);
    });
  });

  // ----- recordExecution -----

  describe("recordExecution", () => {
    it("stores execution as triples", async () => {
      const result = await svc.recordExecution("agent-a", "ls -la", {
        exitCode: 0,
        stdout: "file1\nfile2",
        stderr: "",
        durationMs: 150,
      });

      expect(result.agentId).toBe("agent-a");
      expect(result.command).toBe("ls -la");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("file1\nfile2");
      expect(result.durationMs).toBe(150);
      expect(result.missionId).toBeNull();
      expect(result.id).toBeTruthy();
      expect(result.executedAt).toBeTruthy();

      // Verify triples were stored (7 fields without missionId)
      expect(storedTriples.length).toBe(7);
    });

    it("truncates stdout to 2000 chars", async () => {
      const longOutput = "x".repeat(5000);
      await svc.recordExecution("agent-a", "cat bigfile", {
        exitCode: 0,
        stdout: longOutput,
        stderr: "",
        durationMs: 100,
      });

      // Find the stdout triple
      const stdoutTriple = storedTriples.find((t) => String(t.predicate).includes("stdout"));
      expect(stdoutTriple).toBeTruthy();
      expect(String(stdoutTriple!.object).length).toBe(2000);
    });

    it("includes missionId when provided", async () => {
      const result = await svc.recordExecution(
        "agent-a",
        "npm test",
        { exitCode: 0, stdout: "ok", stderr: "", durationMs: 200 },
        "mission-42",
      );

      expect(result.missionId).toBe("mission-42");

      // 8 fields including missionId
      expect(storedTriples.length).toBe(8);
      const missionTriple = storedTriples.find((t) => String(t.predicate).includes("missionId"));
      expect(missionTriple).toBeTruthy();
      expect(String(missionTriple!.object)).toBe("mission-42");
    });
  });

  // ----- getHistory -----

  describe("getHistory", () => {
    it("returns sorted by executedAt descending", async () => {
      // Record two executions with a small delay
      const first = await svc.recordExecution("agent-a", "echo first", {
        exitCode: 0,
        stdout: "first",
        stderr: "",
        durationMs: 10,
      });

      // Small delay so executedAt differs
      await new Promise((r) => setTimeout(r, 10));

      const second = await svc.recordExecution("agent-a", "echo second", {
        exitCode: 0,
        stdout: "second",
        stderr: "",
        durationMs: 20,
      });

      const history = await svc.getHistory("agent-a");
      expect(history.length).toBe(2);
      // Most recent first
      expect(history[0].command).toBe("echo second");
      expect(history[1].command).toBe("echo first");
    });

    it("returns empty array for unknown agent", async () => {
      const history = await svc.getHistory("nonexistent");
      expect(history).toEqual([]);
    });
  });
});
