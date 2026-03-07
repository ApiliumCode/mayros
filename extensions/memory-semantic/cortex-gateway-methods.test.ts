/**
 * Tests for cortex.status, cortex.reconnect, cortex.triples, cortex.subjects,
 * and cortex.predicates gateway methods.
 *
 * Uses mocks for CortexClient, CortexSidecar, PendingWriteQueue, and HealthMonitor
 * to test the gateway method handlers in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock respond function
function createRespond() {
  return vi.fn() as ReturnType<typeof vi.fn> & {
    (ok: boolean, payload?: unknown): void;
  };
}

// Mock dependencies
function createMocks(overrides?: {
  healthy?: boolean;
  stats?: {
    server: { version: string; uptime_seconds: number };
    graph: { triple_count: number; subject_count: number };
  } | null;
  sidecarStatus?: "stopped" | "starting" | "running" | "failed";
  startResult?: boolean;
  queuedWrites?: number;
  triples?: { triples: unknown[]; total: number };
  subjects?: { subjects: string[]; total: number };
  predicates?: { predicates: string[]; total: number };
}) {
  const opts = {
    healthy: true,
    stats: {
      server: { version: "0.3.7", uptime_seconds: 120 },
      graph: { triple_count: 500, subject_count: 100 },
    },
    sidecarStatus: "running" as const,
    startResult: true,
    queuedWrites: 0,
    ...overrides,
  };

  const client = {
    isHealthy: vi.fn().mockResolvedValue(opts.healthy),
    stats: opts.stats
      ? vi.fn().mockResolvedValue(opts.stats)
      : vi.fn().mockRejectedValue(new Error("stats unavailable")),
    listTriples: vi.fn().mockResolvedValue(opts.triples ?? { triples: [], total: 0 }),
    listSubjects: vi.fn().mockResolvedValue(opts.subjects ?? { subjects: [], total: 0 }),
    listPredicates: vi.fn().mockResolvedValue(opts.predicates ?? { predicates: [], total: 0 }),
  };

  const sidecar = {
    status: opts.sidecarStatus,
    start: vi.fn().mockResolvedValue(opts.startResult),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const writeQueue = {
    getStats: vi.fn().mockReturnValue({ queued: opts.queuedWrites, maxSize: 200 }),
    drain: vi.fn().mockResolvedValue(0),
  };

  const healthMonitor = {
    start: vi.fn(),
    stop: vi.fn(),
  };

  const cfg = {
    cortex: { host: "127.0.0.1", port: 19090, autoStart: true },
  };

  return { client, sidecar, writeQueue, healthMonitor, cfg };
}

// Simulate the cortex.status handler logic inline (mirrors index.ts)
async function handleCortexStatus(
  mocks: ReturnType<typeof createMocks>,
  respond: ReturnType<typeof createRespond>,
) {
  const { client, sidecar, writeQueue, cfg } = mocks;
  const healthy = await client.isHealthy();
  let version: string | null = null;
  let uptime: number | null = null;
  let triples: number | null = null;
  let subjects: number | null = null;
  if (healthy) {
    try {
      const s = await client.stats();
      version = s.server?.version ?? null;
      uptime = s.server?.uptime_seconds ?? null;
      triples = s.graph?.triple_count ?? null;
      subjects = s.graph?.subject_count ?? null;
    } catch {
      /* stats endpoint may not be available */
    }
  }
  respond(true, {
    status: healthy ? "online" : "offline",
    sidecar: sidecar.status,
    endpoint: `${cfg.cortex.host}:${cfg.cortex.port}`,
    autoStart: cfg.cortex.autoStart,
    version,
    uptime,
    triples,
    subjects,
    pendingWrites: writeQueue.getStats().queued,
  });
}

// Simulate the cortex.reconnect handler logic inline (mirrors index.ts)
async function handleCortexReconnect(
  mocks: ReturnType<typeof createMocks>,
  respond: ReturnType<typeof createRespond>,
  setCortexAvailable: (v: boolean) => void,
) {
  const { sidecar, writeQueue, healthMonitor } = mocks;
  if (sidecar.status === "running" || sidecar.status === "starting") {
    await sidecar.stop();
  }
  const started = await sidecar.start();
  setCortexAvailable(started);
  if (started) {
    healthMonitor.start();
    void writeQueue.drain();
  }
  respond(true, {
    success: started,
    status: started ? "online" : "failed",
    sidecar: sidecar.status,
  });
}

// ============================================================================
// cortex.status
// ============================================================================

describe("cortex.status gateway method", () => {
  it("returns online when healthy", async () => {
    const mocks = createMocks({ healthy: true });
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "online",
        sidecar: "running",
        endpoint: "127.0.0.1:19090",
      }),
    );
  });

  it("returns offline when unhealthy", async () => {
    const mocks = createMocks({ healthy: false, sidecarStatus: "failed" });
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "offline",
        sidecar: "failed",
      }),
    );
  });

  it("includes stats when available", async () => {
    const mocks = createMocks({ healthy: true });
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    const payload = respond.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.version).toBe("0.3.7");
    expect(payload.uptime).toBe(120);
    expect(payload.triples).toBe(500);
    expect(payload.subjects).toBe(100);
  });

  it("returns null stats when stats endpoint fails", async () => {
    const mocks = createMocks({ healthy: true, stats: null });
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    const payload = respond.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.status).toBe("online");
    expect(payload.version).toBeNull();
    expect(payload.uptime).toBeNull();
    expect(payload.triples).toBeNull();
  });

  it("includes pending writes count", async () => {
    const mocks = createMocks({ queuedWrites: 5 });
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    const payload = respond.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.pendingWrites).toBe(5);
  });

  it("includes autoStart config value", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexStatus(mocks, respond);

    const payload = respond.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.autoStart).toBe(true);
  });
});

// ============================================================================
// cortex.reconnect
// ============================================================================

describe("cortex.reconnect gateway method", () => {
  it("starts sidecar and returns success", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: true });
    const respond = createRespond();
    let available = false;
    await handleCortexReconnect(mocks, respond, (v) => (available = v));

    expect(mocks.sidecar.start).toHaveBeenCalled();
    expect(available).toBe(true);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        success: true,
        status: "online",
      }),
    );
  });

  it("returns failed when sidecar cannot start", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: false });
    const respond = createRespond();
    let available = true;
    await handleCortexReconnect(mocks, respond, (v) => (available = v));

    expect(available).toBe(false);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        success: false,
        status: "failed",
      }),
    );
  });

  it("drains write queue on success", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: true });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.writeQueue.drain).toHaveBeenCalled();
  });

  it("stops running sidecar before restarting", async () => {
    const mocks = createMocks({ sidecarStatus: "running", startResult: true });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.sidecar.stop).toHaveBeenCalled();
    expect(mocks.sidecar.start).toHaveBeenCalled();
  });

  it("does not stop already-stopped sidecar", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: true });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.sidecar.stop).not.toHaveBeenCalled();
  });

  it("resumes health monitor on success", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: true });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.healthMonitor.start).toHaveBeenCalled();
  });

  it("does not resume health monitor on failure", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: false });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.healthMonitor.start).not.toHaveBeenCalled();
  });

  it("does not drain queue on failure", async () => {
    const mocks = createMocks({ sidecarStatus: "stopped", startResult: false });
    const respond = createRespond();
    await handleCortexReconnect(mocks, respond, () => {});

    expect(mocks.writeQueue.drain).not.toHaveBeenCalled();
  });
});

// ============================================================================
// cortex.triples / cortex.subjects / cortex.predicates handler simulators
// ============================================================================

async function handleCortexTriples(
  mocks: ReturnType<typeof createMocks>,
  respond: ReturnType<typeof createRespond>,
  cortexAvailable: boolean,
  params?: Record<string, unknown>,
) {
  if (!cortexAvailable) {
    respond(false, { error: "Cortex is offline" });
    return;
  }
  try {
    const p = params ?? {};
    const result = await mocks.client.listTriples({
      subject: typeof p.subject === "string" ? p.subject : undefined,
      predicate: typeof p.predicate === "string" ? p.predicate : undefined,
      object: typeof p.object === "string" ? p.object : undefined,
      limit: typeof p.limit === "number" ? p.limit : 50,
      offset: typeof p.offset === "number" ? p.offset : 0,
    });
    respond(true, { triples: result.triples, total: result.total });
  } catch (err) {
    respond(false, { error: String(err) });
  }
}

async function handleCortexSubjects(
  mocks: ReturnType<typeof createMocks>,
  respond: ReturnType<typeof createRespond>,
  cortexAvailable: boolean,
  params?: Record<string, unknown>,
) {
  if (!cortexAvailable) {
    respond(false, { error: "Cortex is offline" });
    return;
  }
  try {
    const p = params ?? {};
    const result = await mocks.client.listSubjects({
      limit: typeof p.limit === "number" ? p.limit : 200,
    });
    respond(true, { subjects: result.subjects, total: result.total });
  } catch (err) {
    respond(false, { error: String(err) });
  }
}

async function handleCortexPredicates(
  mocks: ReturnType<typeof createMocks>,
  respond: ReturnType<typeof createRespond>,
  cortexAvailable: boolean,
  params?: Record<string, unknown>,
) {
  if (!cortexAvailable) {
    respond(false, { error: "Cortex is offline" });
    return;
  }
  try {
    const p = params ?? {};
    const result = await mocks.client.listPredicates({
      limit: typeof p.limit === "number" ? p.limit : 200,
    });
    respond(true, { predicates: result.predicates, total: result.total });
  } catch (err) {
    respond(false, { error: String(err) });
  }
}

// ============================================================================
// cortex.triples
// ============================================================================

describe("cortex.triples gateway method", () => {
  it("returns error when cortex is offline", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexTriples(mocks, respond, false);

    expect(respond).toHaveBeenCalledWith(false, { error: "Cortex is offline" });
  });

  it("returns triples with default pagination", async () => {
    const fakeTriples = [{ id: "1", subject: "ns:test", predicate: "type", object: "demo" }];
    const mocks = createMocks({ triples: { triples: fakeTriples, total: 1 } });
    const respond = createRespond();
    await handleCortexTriples(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(true, { triples: fakeTriples, total: 1 });
    expect(mocks.client.listTriples).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("passes subject and predicate filters", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexTriples(mocks, respond, true, {
      subject: "ns:session:abc",
      predicate: "type",
    });

    expect(mocks.client.listTriples).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "ns:session:abc",
        predicate: "type",
      }),
    );
  });

  it("passes custom limit and offset", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexTriples(mocks, respond, true, { limit: 10, offset: 20 });

    expect(mocks.client.listTriples).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        offset: 20,
      }),
    );
  });

  it("returns error on client failure", async () => {
    const mocks = createMocks();
    mocks.client.listTriples.mockRejectedValueOnce(new Error("connection reset"));
    const respond = createRespond();
    await handleCortexTriples(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(false, {
      error: expect.stringContaining("connection reset"),
    });
  });
});

// ============================================================================
// cortex.subjects
// ============================================================================

describe("cortex.subjects gateway method", () => {
  it("returns error when cortex is offline", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexSubjects(mocks, respond, false);

    expect(respond).toHaveBeenCalledWith(false, { error: "Cortex is offline" });
  });

  it("returns subjects with default limit", async () => {
    const mocks = createMocks({
      subjects: { subjects: ["ns:a", "ns:b"], total: 2 },
    });
    const respond = createRespond();
    await handleCortexSubjects(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(true, {
      subjects: ["ns:a", "ns:b"],
      total: 2,
    });
    expect(mocks.client.listSubjects).toHaveBeenCalledWith({ limit: 200 });
  });

  it("passes custom limit", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexSubjects(mocks, respond, true, { limit: 50 });

    expect(mocks.client.listSubjects).toHaveBeenCalledWith({ limit: 50 });
  });

  it("returns error on client failure", async () => {
    const mocks = createMocks();
    mocks.client.listSubjects.mockRejectedValueOnce(new Error("timeout"));
    const respond = createRespond();
    await handleCortexSubjects(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(false, { error: expect.stringContaining("timeout") });
  });
});

// ============================================================================
// cortex.predicates
// ============================================================================

describe("cortex.predicates gateway method", () => {
  it("returns error when cortex is offline", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexPredicates(mocks, respond, false);

    expect(respond).toHaveBeenCalledWith(false, { error: "Cortex is offline" });
  });

  it("returns predicates with default limit", async () => {
    const mocks = createMocks({
      predicates: { predicates: ["type", "name", "createdAt"], total: 3 },
    });
    const respond = createRespond();
    await handleCortexPredicates(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(true, {
      predicates: ["type", "name", "createdAt"],
      total: 3,
    });
    expect(mocks.client.listPredicates).toHaveBeenCalledWith({ limit: 200 });
  });

  it("passes custom limit", async () => {
    const mocks = createMocks();
    const respond = createRespond();
    await handleCortexPredicates(mocks, respond, true, { limit: 100 });

    expect(mocks.client.listPredicates).toHaveBeenCalledWith({ limit: 100 });
  });

  it("returns error on client failure", async () => {
    const mocks = createMocks();
    mocks.client.listPredicates.mockRejectedValueOnce(new Error("not found"));
    const respond = createRespond();
    await handleCortexPredicates(mocks, respond, true);

    expect(respond).toHaveBeenCalledWith(false, { error: expect.stringContaining("not found") });
  });
});
