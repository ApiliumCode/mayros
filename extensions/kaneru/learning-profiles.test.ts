import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LearningProfileManager, classifyMission } from "./learning-profiles.js";
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

describe("LearningProfileManager", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let mgr: LearningProfileManager;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    mgr = new LearningProfileManager(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- recordOutcome -----

  describe("recordOutcome", () => {
    it("creates profile for new agent and classifies mission from title", async () => {
      const profile = await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Implement user authentication",
        success: true,
        durationMs: 5000,
      });

      expect(profile.agentId).toBe("agent-1");
      expect(profile.taskType).toBe("implementation");
      expect(profile.missionCount).toBe(1);
      expect(profile.successRate).toBe(1);
      expect(profile.expertise).toBeGreaterThan(0.5);
      expect(profile.lastUpdated).toBeTruthy();
    });

    it("updates existing profile with EMA and increments missionCount", async () => {
      await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Implement feature A",
        success: true,
        durationMs: 3000,
      });

      const second = await mgr.recordOutcome({
        missionId: "m-2",
        agentId: "agent-1",
        title: "Implement feature B",
        success: true,
        durationMs: 7000,
      });

      expect(second.missionCount).toBe(2);
      expect(second.successRate).toBe(1);
      expect(second.avgDurationMs).toBe(5000);
      expect(second.expertise).toBeGreaterThan(0.5);
    });

    it("success=false produces lower expertise than success=true", async () => {
      const success = await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-s",
        title: "Test coverage check",
        success: true,
        durationMs: 1000,
      });

      const failure = await mgr.recordOutcome({
        missionId: "m-2",
        agentId: "agent-f",
        title: "Test coverage check",
        success: false,
        durationMs: 1000,
      });

      expect(failure.expertise).toBeLessThan(success.expertise);
    });

    it("uses provided domain and taskType when given", async () => {
      const profile = await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Some random title",
        success: true,
        durationMs: 2000,
        domain: "rust",
        taskType: "security-scan",
      });

      expect(profile.domain).toBe("rust");
      expect(profile.taskType).toBe("security-scan");
    });
  });

  // ----- getProfile -----

  describe("getProfile", () => {
    it("returns profile after recording outcome", async () => {
      await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Implement feature",
        success: true,
        durationMs: 4000,
      });

      const profile = await mgr.getProfile("agent-1", "general", "implementation");
      expect(profile).not.toBeNull();
      expect(profile!.agentId).toBe("agent-1");
      expect(profile!.missionCount).toBe(1);
    });

    it("returns null for missing profile", async () => {
      const profile = await mgr.getProfile("nonexistent", "general", "implementation");
      expect(profile).toBeNull();
    });
  });

  // ----- getAgentProfiles -----

  describe("getAgentProfiles", () => {
    it("returns all profiles for an agent sorted by expertise", async () => {
      await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Review PR",
        success: false,
        durationMs: 1000,
        domain: "typescript",
        taskType: "code-review",
      });
      await mgr.recordOutcome({
        missionId: "m-2",
        agentId: "agent-1",
        title: "Fix bug",
        success: true,
        durationMs: 2000,
        domain: "typescript",
        taskType: "debugging",
      });

      const profiles = await mgr.getAgentProfiles("agent-1");
      expect(profiles).toHaveLength(2);
      // Sorted by expertise descending — the successful one should be first
      expect(profiles[0].expertise).toBeGreaterThanOrEqual(profiles[1].expertise);
    });
  });

  // ----- getExpertise -----

  describe("getExpertise", () => {
    it("returns expertise score after recording", async () => {
      const recorded = await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-1",
        title: "Debug crash",
        success: true,
        durationMs: 3000,
        domain: "general",
        taskType: "debugging",
      });

      const expertise = await mgr.getExpertise("agent-1", "general", "debugging");
      expect(expertise).toBe(recorded.expertise);
    });

    it("returns 0.5 for unknown agent/domain", async () => {
      const expertise = await mgr.getExpertise("unknown", "general", "debugging");
      expect(expertise).toBe(0.5);
    });
  });

  // ----- topAgents -----

  describe("topAgents", () => {
    it("returns agents ranked by expertise", async () => {
      // Record successful for agent-a, failed for agent-b
      await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-a",
        title: "t",
        success: true,
        durationMs: 1000,
        domain: "typescript",
        taskType: "implementation",
      });
      await mgr.recordOutcome({
        missionId: "m-2",
        agentId: "agent-b",
        title: "t",
        success: false,
        durationMs: 1000,
        domain: "typescript",
        taskType: "implementation",
      });

      const top = await mgr.topAgents("typescript", "implementation");
      expect(top).toHaveLength(2);
      expect(top[0].agentId).toBe("agent-a");
      expect(top[0].expertise).toBeGreaterThan(top[1].expertise);
    });

    it("respects limit parameter", async () => {
      await mgr.recordOutcome({
        missionId: "m-1",
        agentId: "agent-a",
        title: "t",
        success: true,
        durationMs: 1000,
        domain: "go",
        taskType: "testing",
      });
      await mgr.recordOutcome({
        missionId: "m-2",
        agentId: "agent-b",
        title: "t",
        success: true,
        durationMs: 1000,
        domain: "go",
        taskType: "testing",
      });

      const top = await mgr.topAgents("go", "testing", 1);
      expect(top).toHaveLength(1);
    });
  });
});

// ============================================================================
// classifyMission (pure function)
// ============================================================================

describe("classifyMission", () => {
  it("detects implementation from title keywords", () => {
    const result = classifyMission("Implement new authentication feature");
    expect(result.taskType).toBe("implementation");
  });

  it("detects debugging from title keywords", () => {
    const result = classifyMission("Fix crash in parser module");
    expect(result.taskType).toBe("debugging");
  });

  it("detects security-scan from title keywords", () => {
    const result = classifyMission("Run security audit for CVE-2025");
    expect(result.taskType).toBe("security-scan");
  });

  it("detects language domain from title", () => {
    const result = classifyMission("Refactor typescript utility functions");
    expect(result.domain).toBe("typescript");
    expect(result.taskType).toBe("refactoring");
  });

  it("returns general for unrecognized titles", () => {
    const result = classifyMission("Do some things");
    expect(result.taskType).toBe("general");
    expect(result.domain).toBe("general");
  });
});
