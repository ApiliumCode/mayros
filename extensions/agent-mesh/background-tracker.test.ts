/**
 * Tests for BackgroundTracker.
 *
 * Mocks CortexClient to verify task tracking, status updates,
 * progress, cancellation, listing, and summary.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  BackgroundTracker,
  isValidBackgroundTaskStatus,
  type BackgroundTaskStatus,
} from "./background-tracker.js";
import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Mock factory
// ============================================================================

type Triple = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
};

function makeMockClient(): CortexClient & { _triples: Triple[] } {
  const triples: Triple[] = [];
  let nextId = 1;

  return {
    _triples: triples,
    createTriple: vi.fn(async (t: { subject: string; predicate: string; object: unknown }) => {
      const id = `t-${nextId++}`;
      triples.push({
        id,
        subject: t.subject,
        predicate: t.predicate,
        object: String(t.object),
      });
      return { ok: true, id };
    }),
    deleteTriple: vi.fn(async (id: string) => {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
      return { ok: true };
    }),
    listTriples: vi.fn(async (query: { subject?: string; predicate?: string; limit?: number }) => {
      let matches = [...triples];
      if (query.subject) matches = matches.filter((t) => t.subject === query.subject);
      if (query.predicate) matches = matches.filter((t) => t.predicate === query.predicate);
      if (query.limit) matches = matches.slice(0, query.limit);
      return { triples: matches };
    }),
    patternQuery: vi.fn(async (query: { predicate?: string; object?: string; limit?: number }) => {
      let matches = [...triples];
      if (query.predicate) matches = matches.filter((t) => t.predicate === query.predicate);
      if (query.object) matches = matches.filter((t) => t.object === query.object);
      if (query.limit) matches = matches.slice(0, query.limit);
      return {
        matches: matches.map((t) => ({
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
        })),
      };
    }),
  } as unknown as CortexClient & { _triples: Triple[] };
}

// ============================================================================
// Tests
// ============================================================================

describe("BackgroundTracker", () => {
  const ns = "mayros";
  let client: ReturnType<typeof makeMockClient>;
  let tracker: BackgroundTracker;

  beforeEach(() => {
    client = makeMockClient();
    tracker = new BackgroundTracker(client, ns);
  });

  // ---------- track ----------

  test("track creates correct triples", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "Run background analysis",
    });

    expect(task.id).toBeDefined();
    expect(task.agentId).toBe("agent-1");
    expect(task.description).toBe("Run background analysis");
    expect(task.status).toBe("running");
    expect(task.startedAt).toBeDefined();

    // Check triples were created
    const agentTriple = client._triples.find((t) => t.predicate === "mayros:bgtask:agentId");
    expect(agentTriple).toBeDefined();
    expect(agentTriple!.object).toBe("agent-1");
  });

  test("track with explicit status", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "Queued task",
      status: "pending",
    });
    expect(task.status).toBe("pending");
  });

  // ---------- updateStatus ----------

  test("updateStatus transitions correctly", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "test",
    });

    const ok = await tracker.updateStatus(task.id, "completed", "All done");
    expect(ok).toBe(true);

    const updated = await tracker.getTask(task.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.result).toBe("All done");
    expect(updated!.completedAt).toBeDefined();
  });

  test("updateStatus returns false for nonexistent task", async () => {
    const ok = await tracker.updateStatus("nonexistent", "completed");
    expect(ok).toBe(false);
  });

  test("updateStatus to failed sets completedAt", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "test",
    });

    await tracker.updateStatus(task.id, "failed");
    const updated = await tracker.getTask(task.id);
    expect(updated!.completedAt).toBeDefined();
  });

  // ---------- updateProgress ----------

  test("updateProgress clamps 0-100", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "test",
    });

    await tracker.updateProgress(task.id, 150);
    let updated = await tracker.getTask(task.id);
    expect(updated!.progress).toBe(100);

    await tracker.updateProgress(task.id, -10);
    updated = await tracker.getTask(task.id);
    expect(updated!.progress).toBe(0);

    await tracker.updateProgress(task.id, 42);
    updated = await tracker.getTask(task.id);
    expect(updated!.progress).toBe(42);
  });

  test("updateProgress returns false for nonexistent task", async () => {
    const ok = await tracker.updateProgress("nonexistent", 50);
    expect(ok).toBe(false);
  });

  // ---------- cancel ----------

  test("cancel sets status to cancelled", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "test",
    });

    const ok = await tracker.cancel(task.id);
    expect(ok).toBe(true);

    const updated = await tracker.getTask(task.id);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.completedAt).toBeDefined();
  });

  test("double cancel is idempotent", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "test",
    });

    await tracker.cancel(task.id);
    const ok = await tracker.cancel(task.id);
    expect(ok).toBe(true);

    const updated = await tracker.getTask(task.id);
    expect(updated!.status).toBe("cancelled");
  });

  test("cancel returns false for nonexistent task", async () => {
    const ok = await tracker.cancel("nonexistent");
    expect(ok).toBe(false);
  });

  // ---------- getTask ----------

  test("getTask reconstructs from triples", async () => {
    const task = await tracker.track({
      agentId: "agent-1",
      description: "Important work",
    });

    const retrieved = await tracker.getTask(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agentId).toBe("agent-1");
    expect(retrieved!.description).toBe("Important work");
    expect(retrieved!.status).toBe("running");
  });

  test("getTask returns null for nonexistent", async () => {
    const task = await tracker.getTask("nonexistent");
    expect(task).toBeNull();
  });

  // ---------- listTasks ----------

  test("listTasks returns all tasks", async () => {
    await tracker.track({ agentId: "a1", description: "task 1" });
    await tracker.track({ agentId: "a2", description: "task 2" });

    const tasks = await tracker.listTasks();
    expect(tasks).toHaveLength(2);
  });

  test("listTasks filters by status", async () => {
    const t1 = await tracker.track({ agentId: "a1", description: "running task" });
    const t2 = await tracker.track({
      agentId: "a2",
      description: "pending task",
      status: "pending",
    });

    const running = await tracker.listTasks({ status: "running" });
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(t1.id);

    const pending = await tracker.listTasks({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(t2.id);
  });

  test("listTasks filters by agentId", async () => {
    await tracker.track({ agentId: "a1", description: "task 1" });
    await tracker.track({ agentId: "a2", description: "task 2" });

    const tasks = await tracker.listTasks({ agentId: "a1" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentId).toBe("a1");
  });

  test("listTasks respects limit", async () => {
    await tracker.track({ agentId: "a1", description: "task 1" });
    await tracker.track({ agentId: "a1", description: "task 2" });
    await tracker.track({ agentId: "a1", description: "task 3" });

    const tasks = await tracker.listTasks({ limit: 2 });
    expect(tasks).toHaveLength(2);
  });

  // ---------- summary ----------

  test("summary returns correct counts", async () => {
    await tracker.track({ agentId: "a1", description: "running" });
    const t2 = await tracker.track({ agentId: "a2", description: "to complete" });
    const t3 = await tracker.track({ agentId: "a3", description: "to fail" });
    await tracker.track({ agentId: "a4", description: "pending", status: "pending" });

    await tracker.updateStatus(t2.id, "completed");
    await tracker.updateStatus(t3.id, "failed");

    const s = await tracker.summary();
    expect(s.total).toBe(4);
    expect(s.running).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.cancelled).toBe(0);
  });

  test("summary with no tasks", async () => {
    const s = await tracker.summary();
    expect(s.total).toBe(0);
    expect(s.running).toBe(0);
    expect(s.tasks).toEqual([]);
  });

  // ---------- isValidBackgroundTaskStatus ----------

  test("isValidBackgroundTaskStatus validates correctly", () => {
    expect(isValidBackgroundTaskStatus("running")).toBe(true);
    expect(isValidBackgroundTaskStatus("completed")).toBe(true);
    expect(isValidBackgroundTaskStatus("failed")).toBe(true);
    expect(isValidBackgroundTaskStatus("cancelled")).toBe(true);
    expect(isValidBackgroundTaskStatus("pending")).toBe(true);
    expect(isValidBackgroundTaskStatus("unknown")).toBe(false);
    expect(isValidBackgroundTaskStatus("")).toBe(false);
  });
});
