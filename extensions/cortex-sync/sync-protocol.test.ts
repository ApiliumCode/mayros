import { describe, it, expect, vi } from "vitest";
import type { TripleDto } from "../shared/cortex-client.js";
import {
  detectConflicts,
  resolveConflict,
  reconcile,
  applyDelta,
  type SyncDelta,
} from "./sync-protocol.js";

// ============================================================================
// Test helpers
// ============================================================================

function triple(
  subject: string,
  predicate: string,
  object: string,
  created_at?: string,
): TripleDto {
  return { id: `id-${subject}-${predicate}`, subject, predicate, object, created_at };
}

function makeDelta(triples: TripleDto[], since = "2024-01-01T00:00:00Z"): SyncDelta {
  return {
    since,
    nodeId: "remote-1",
    triples,
    deletions: [],
    syncedAt: new Date().toISOString(),
  };
}

// ============================================================================
// detectConflicts
// ============================================================================

describe("detectConflicts", () => {
  it("detects conflicts on same subject+predicate with different objects", () => {
    const local = [triple("s1", "p1", "local-value")];
    const remote = [triple("s1", "p1", "remote-value")];

    const conflicts = detectConflicts(local, remote);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.object).toBe("local-value");
    expect(conflicts[0].remote.object).toBe("remote-value");
  });

  it("returns empty when no conflicts", () => {
    const local = [triple("s1", "p1", "same-value")];
    const remote = [triple("s1", "p1", "same-value")];

    expect(detectConflicts(local, remote)).toHaveLength(0);
  });

  it("returns empty when remote has new subjects", () => {
    const local = [triple("s1", "p1", "v1")];
    const remote = [triple("s2", "p2", "v2")];

    expect(detectConflicts(local, remote)).toHaveLength(0);
  });

  it("handles multiple conflicts", () => {
    const local = [
      triple("s1", "p1", "lv1"),
      triple("s2", "p2", "lv2"),
      triple("s3", "p3", "same"),
    ];
    const remote = [
      triple("s1", "p1", "rv1"),
      triple("s2", "p2", "rv2"),
      triple("s3", "p3", "same"),
    ];

    expect(detectConflicts(local, remote)).toHaveLength(2);
  });

  it("handles empty arrays", () => {
    expect(detectConflicts([], [])).toHaveLength(0);
    expect(detectConflicts([], [triple("s1", "p1", "v1")])).toHaveLength(0);
    expect(detectConflicts([triple("s1", "p1", "v1")], [])).toHaveLength(0);
  });
});

// ============================================================================
// resolveConflict
// ============================================================================

describe("resolveConflict", () => {
  const localT = triple("s1", "p1", "local", "2024-01-01T00:00:00Z");
  const remoteT = triple("s1", "p1", "remote", "2024-01-02T00:00:00Z");

  it("last-writer-wins: remote wins when newer", () => {
    const result = resolveConflict(localT, remoteT, "last-writer-wins");
    expect(result.resolution).toBe("kept-remote");
  });

  it("last-writer-wins: local wins when newer", () => {
    const newerLocal = triple("s1", "p1", "local", "2024-01-03T00:00:00Z");
    const result = resolveConflict(newerLocal, remoteT, "last-writer-wins");
    expect(result.resolution).toBe("kept-local");
  });

  it("local-priority always keeps local", () => {
    const result = resolveConflict(localT, remoteT, "local-priority");
    expect(result.resolution).toBe("kept-local");
  });

  it("remote-priority always keeps remote", () => {
    const result = resolveConflict(localT, remoteT, "remote-priority");
    expect(result.resolution).toBe("kept-remote");
  });

  it("keep-both keeps both", () => {
    const result = resolveConflict(localT, remoteT, "keep-both");
    expect(result.resolution).toBe("kept-both");
  });
});

// ============================================================================
// reconcile
// ============================================================================

describe("reconcile", () => {
  it("adds new remote triples not in local", () => {
    const local: TripleDto[] = [triple("s1", "p1", "v1")];
    const delta = makeDelta([triple("s2", "p2", "v2")]);

    const { toCreate, conflicts } = reconcile(local, delta, "last-writer-wins");
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].subject).toBe("s2");
    expect(conflicts).toHaveLength(0);
  });

  it("skips triples that already exist locally (exact match)", () => {
    const local: TripleDto[] = [triple("s1", "p1", "v1")];
    const delta = makeDelta([triple("s1", "p1", "v1")]);

    const { toCreate } = reconcile(local, delta, "last-writer-wins");
    expect(toCreate).toHaveLength(0);
  });

  it("handles conflicts with last-writer-wins", () => {
    const local = [triple("s1", "p1", "local", "2024-01-01T00:00:00Z")];
    const delta = makeDelta([triple("s1", "p1", "remote", "2024-01-02T00:00:00Z")]);

    const { toCreate, conflicts } = reconcile(local, delta, "last-writer-wins");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("kept-remote");
    expect(toCreate).toHaveLength(1);
  });

  it("skips conflicting triples when local-priority", () => {
    const local = [triple("s1", "p1", "local", "2024-01-01T00:00:00Z")];
    const delta = makeDelta([triple("s1", "p1", "remote", "2024-01-02T00:00:00Z")]);

    const { toCreate, conflicts } = reconcile(local, delta, "local-priority");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("kept-local");
    // Local wins, so remote triple should not be created
    expect(toCreate).toHaveLength(0);
  });

  it("handles mixed new + conflicting triples", () => {
    const local = [triple("s1", "p1", "local-v", "2024-01-01T00:00:00Z")];
    const delta = makeDelta([
      triple("s1", "p1", "remote-v", "2024-01-02T00:00:00Z"),
      triple("s2", "p2", "brand-new"),
    ]);

    const { toCreate, conflicts } = reconcile(local, delta, "last-writer-wins");
    expect(conflicts).toHaveLength(1);
    // s1 conflict resolved as remote win + s2 new = 2 creates
    expect(toCreate).toHaveLength(2);
  });

  it("handles empty local state", () => {
    const delta = makeDelta([triple("s1", "p1", "v1"), triple("s2", "p2", "v2")]);

    const { toCreate, conflicts } = reconcile([], delta, "last-writer-wins");
    expect(toCreate).toHaveLength(2);
    expect(conflicts).toHaveLength(0);
  });

  it("handles empty remote delta", () => {
    const local = [triple("s1", "p1", "v1")];
    const delta = makeDelta([]);

    const { toCreate, conflicts } = reconcile(local, delta, "last-writer-wins");
    expect(toCreate).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });
});

// ============================================================================
// applyDelta
// ============================================================================

describe("applyDelta", () => {
  it("creates triples via client", async () => {
    const createTriple = vi.fn().mockResolvedValue({});
    const mockClient = {
      createTriple,
    } as unknown as import("../shared/cortex-client.js").CortexClient;

    const result = await applyDelta(mockClient, [
      { subject: "s1", predicate: "p1", object: "v1" },
      { subject: "s2", predicate: "p2", object: "v2" },
    ]);

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(0);
    expect(createTriple).toHaveBeenCalledTimes(2);
  });

  it("skips individual failures and continues", async () => {
    const createTriple = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({});
    const mockClient = {
      createTriple,
    } as unknown as import("../shared/cortex-client.js").CortexClient;

    const result = await applyDelta(mockClient, [
      { subject: "s1", predicate: "p1", object: "v1" },
      { subject: "s2", predicate: "p2", object: "v2" },
      { subject: "s3", predicate: "p3", object: "v3" },
    ]);

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(1);
    expect(createTriple).toHaveBeenCalledTimes(3);
  });

  it("handles empty input", async () => {
    const mockClient = {
      createTriple: vi.fn(),
    } as unknown as import("../shared/cortex-client.js").CortexClient;
    const result = await applyDelta(mockClient, []);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(0);
  });
});
