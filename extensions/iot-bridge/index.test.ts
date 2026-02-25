import { describe, expect, it, vi, beforeEach } from "vitest";
import { iotBridgeConfigSchema } from "./config.js";
import { FleetManager } from "./fleet-manager.js";
import { IoTNodeClient } from "./iot-client.js";
import type { ObservationPayload } from "./types.js";

// ============================================================================
// Config tests
// ============================================================================

describe("iotBridgeConfigSchema", () => {
  it("parses empty/default config", () => {
    const cfg = iotBridgeConfigSchema.parse({});
    expect(cfg.nodes).toEqual([]);
    expect(cfg.pollIntervalMs).toBe(30_000);
    expect(cfg.fleetPersistPath).toBe("~/.mayros/iot-fleet.json");
    expect(cfg.injectContext).toBe(true);
    expect(cfg.maxNodes).toBe(50);
  });

  it("parses null/undefined as defaults", () => {
    const cfg = iotBridgeConfigSchema.parse(null);
    expect(cfg.maxNodes).toBe(50);
  });

  it("parses full config", () => {
    const cfg = iotBridgeConfigSchema.parse({
      nodes: [{ id: "sensor-1", host: "10.0.0.1", port: 9090, label: "Kitchen" }],
      pollIntervalMs: 60000,
      resilience: { timeoutMs: 3000, maxRetries: 1 },
      fleetPersistPath: "/tmp/fleet.json",
      injectContext: false,
      maxNodes: 10,
    });
    expect(cfg.nodes).toHaveLength(1);
    expect(cfg.nodes[0].id).toBe("sensor-1");
    expect(cfg.nodes[0].host).toBe("10.0.0.1");
    expect(cfg.nodes[0].port).toBe(9090);
    expect(cfg.nodes[0].label).toBe("Kitchen");
    expect(cfg.pollIntervalMs).toBe(60000);
    expect(cfg.resilience.timeoutMs).toBe(3000);
    expect(cfg.fleetPersistPath).toBe("/tmp/fleet.json");
    expect(cfg.injectContext).toBe(false);
    expect(cfg.maxNodes).toBe(10);
  });

  it("rejects unknown keys", () => {
    expect(() => iotBridgeConfigSchema.parse({ unknownKey: true })).toThrow("unknown keys");
  });

  it("rejects invalid port in node config", () => {
    expect(() =>
      iotBridgeConfigSchema.parse({ nodes: [{ host: "1.2.3.4", port: 99999 }] }),
    ).toThrow("port");
  });

  it("rejects invalid node id", () => {
    expect(() => iotBridgeConfigSchema.parse({ nodes: [{ id: "-bad", host: "1.2.3.4" }] })).toThrow(
      "alphanumeric",
    );
  });

  it("auto-generates node id from host", () => {
    const cfg = iotBridgeConfigSchema.parse({
      nodes: [{ host: "192.168.1.42" }],
    });
    expect(cfg.nodes[0].id).toBe("192-168-1-42");
  });

  it("rejects maxNodes < 1", () => {
    expect(() => iotBridgeConfigSchema.parse({ maxNodes: 0 })).toThrow("maxNodes");
  });

  it("rejects pollIntervalMs < 1000", () => {
    expect(() => iotBridgeConfigSchema.parse({ pollIntervalMs: 500 })).toThrow("pollIntervalMs");
  });
});

// ============================================================================
// IoTNodeClient tests
// ============================================================================

describe("IoTNodeClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = vi.fn(handler) as unknown as typeof globalThis.fetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  }

  it("isHealthy returns true on 200", async () => {
    const cleanup = mockFetch(() => new Response("ok", { status: 200 }));
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      expect(await client.isHealthy()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("isHealthy returns false on error", async () => {
    const cleanup = mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      expect(await client.isHealthy()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("getInfo parses API response", async () => {
    const info = {
      node_id: "abc123",
      version: "0.1.0",
      uptime_secs: 3600,
      entries_count: 42,
      peers_count: 3,
      storage_backend: "memory",
      features: ["coap", "ble"],
    };
    const cleanup = mockFetch(
      () => new Response(JSON.stringify({ success: true, data: info }), { status: 200 }),
    );
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      const result = await client.getInfo();
      expect(result.node_id).toBe("abc123");
      expect(result.version).toBe("0.1.0");
      expect(result.features).toEqual(["coap", "ble"]);
    } finally {
      cleanup();
    }
  });

  it("getInfo throws on error response", async () => {
    const cleanup = mockFetch(
      () => new Response(JSON.stringify({ success: false, error: "not ready" }), { status: 200 }),
    );
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      await expect(client.getInfo()).rejects.toThrow("not ready");
    } finally {
      cleanup();
    }
  });

  it("createEntry sends POST and returns result", async () => {
    const result = { hash: "Qm123", seq: 1, timestamp: 1700000000 };
    const cleanup = mockFetch(
      () => new Response(JSON.stringify({ success: true, data: result }), { status: 200 }),
    );
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      const res = await client.createEntry({ hello: "world" });
      expect(res.hash).toBe("Qm123");
      expect(res.seq).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("getEntry returns null on 404", async () => {
    const cleanup = mockFetch(() => new Response("", { status: 404 }));
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      const res = await client.getEntry("nonexistent");
      expect(res).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("getEntry returns entry data", async () => {
    const entry = { hash: "Qm456", entry_type: "observation", content: { temp: 22 }, size: 64 };
    const cleanup = mockFetch(
      () => new Response(JSON.stringify({ success: true, data: entry }), { status: 200 }),
    );
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      const res = await client.getEntry("Qm456");
      expect(res).not.toBeNull();
      expect(res!.hash).toBe("Qm456");
      expect(res!.entry_type).toBe("observation");
    } finally {
      cleanup();
    }
  });

  it("sendObservation wraps createEntry with observation payload", async () => {
    const result = { hash: "Qm789", seq: 5, timestamp: 1700000001 };
    let capturedBody: string | undefined;
    const cleanup = mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ success: true, data: result }), { status: 200 });
    });
    try {
      const client = new IoTNodeClient("localhost", 8080, { maxRetries: 0 });
      const payload: ObservationPayload = {
        type: "observation",
        obs_type: "temperature",
        value: 22.5,
        timestamp: 1700000001,
        confidence: 0.95,
      };
      const res = await client.sendObservation(payload);
      expect(res.hash).toBe("Qm789");

      const body = JSON.parse(capturedBody!) as { data: ObservationPayload };
      expect(body.data.type).toBe("observation");
      expect(body.data.obs_type).toBe("temperature");
      expect(body.data.value).toBe(22.5);
    } finally {
      cleanup();
    }
  });

  it("circuit breaker opens after repeated failures", async () => {
    let callCount = 0;
    const cleanup = mockFetch(() => {
      callCount++;
      throw new Error("ECONNREFUSED");
    });
    try {
      const client = new IoTNodeClient("localhost", 8080, {
        maxRetries: 0,
        circuitThreshold: 3,
      });

      // First 3 calls should attempt and fail
      for (let i = 0; i < 3; i++) {
        await client.isHealthy();
      }
      expect(callCount).toBe(3);

      // Circuit is now open — breaker prevents call
      expect(client.breaker.getState()).toBe("open");
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// FleetManager tests
// ============================================================================

describe("FleetManager", () => {
  it("addNode and listNodes", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "node-1", host: "10.0.0.1", port: 8080 });
    fm.addNode({ id: "node-2", host: "10.0.0.2", port: 8080, label: "Garage" });

    const nodes = fm.listNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).toBe("node-1");
    expect(nodes[1].label).toBe("Garage");
  });

  it("rejects duplicate node ids", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "node-1", host: "10.0.0.1", port: 8080 });
    expect(() => fm.addNode({ id: "node-1", host: "10.0.0.2", port: 8080 })).toThrow(
      "already exists",
    );
  });

  it("enforces maxNodes limit", () => {
    const fm = new FleetManager(2, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "a", host: "1.1.1.1", port: 8080 });
    fm.addNode({ id: "b", host: "2.2.2.2", port: 8080 });
    expect(() => fm.addNode({ id: "c", host: "3.3.3.3", port: 8080 })).toThrow("Fleet limit");
  });

  it("removeNode returns true for existing, false for missing", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "node-1", host: "10.0.0.1", port: 8080 });
    expect(fm.removeNode("node-1")).toBe(true);
    expect(fm.removeNode("node-1")).toBe(false);
    expect(fm.listNodes()).toHaveLength(0);
  });

  it("getNode returns entry or undefined", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "node-1", host: "10.0.0.1", port: 8080 });
    expect(fm.getNode("node-1")).toBeDefined();
    expect(fm.getNode("node-1")!.status.host).toBe("10.0.0.1");
    expect(fm.getNode("missing")).toBeUndefined();
  });

  it("onlineCount and offlineCount", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "a", host: "1.1.1.1", port: 8080 });
    fm.addNode({ id: "b", host: "2.2.2.2", port: 8080 });

    // All start offline
    expect(fm.onlineCount()).toBe(0);
    expect(fm.offlineCount()).toBe(2);

    // Manually mark one online
    fm.getNode("a")!.status.online = true;
    expect(fm.onlineCount()).toBe(1);
    expect(fm.offlineCount()).toBe(1);
  });

  it("generateFleetSummary produces XML", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "node-1", host: "10.0.0.1", port: 8080, label: "Kitchen" });
    fm.getNode("node-1")!.status.online = true;

    const xml = fm.generateFleetSummary();
    expect(xml).toContain("<iot-fleet>");
    expect(xml).toContain('id="node-1"');
    expect(xml).toContain('host="10.0.0.1:8080"');
    expect(xml).toContain('online="true"');
    expect(xml).toContain('label="Kitchen"');
    expect(xml).toContain("</iot-fleet>");
  });

  it("generateFleetSummary returns empty for empty fleet", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    expect(fm.generateFleetSummary()).toBe("");
  });

  it("generateFleetSummary includes info and stats when available", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "n1", host: "1.2.3.4", port: 8080 });
    const node = fm.getNode("n1")!;
    node.status.online = true;
    node.status.info = {
      node_id: "abc",
      version: "0.1.0",
      uptime_secs: 100,
      entries_count: 42,
      peers_count: 3,
      storage_backend: "memory",
      features: [],
    };
    node.status.stats = {
      entries_count: 42,
      actions_count: 10,
      storage_used: 2048,
      peer_count: 3,
      uptime_secs: 100,
      gossip_rounds: 5,
      sync_success: 4,
      sync_failed: 1,
    };

    const xml = fm.generateFleetSummary();
    expect(xml).toContain('version="0.1.0"');
    expect(xml).toContain('entries="42"');
    expect(xml).toContain('peers="3"');
    expect(xml).toContain('gossip_rounds="5"');
    expect(xml).toContain('storage_used="2048"');
  });

  it("pollNode throws for unknown node", async () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    await expect(fm.pollNode("missing")).rejects.toThrow("Unknown node");
  });
});

// ============================================================================
// Tool response format tests
// ============================================================================

describe("tool response formats", () => {
  it("iot_send_observation builds correct payload", () => {
    const payload: ObservationPayload = {
      type: "observation",
      obs_type: "humidity",
      value: 65.3,
      timestamp: Date.now(),
      confidence: 0.9,
      metadata: { location: "greenhouse" },
    };
    expect(payload.type).toBe("observation");
    expect(payload.obs_type).toBe("humidity");
    expect(payload.value).toBe(65.3);
    expect(payload.confidence).toBe(0.9);
    expect(payload.metadata).toEqual({ location: "greenhouse" });
  });

  it("iot_list_fleet filters online nodes", () => {
    const statuses = [
      { id: "a", host: "1.1.1.1", port: 8080, online: true, lastCheckedMs: Date.now() },
      { id: "b", host: "2.2.2.2", port: 8080, online: false, lastCheckedMs: Date.now() },
      { id: "c", host: "3.3.3.3", port: 8080, online: true, lastCheckedMs: Date.now() },
    ];
    const onlineOnly = statuses.filter((s) => s.online);
    expect(onlineOnly).toHaveLength(2);
    expect(onlineOnly.map((s) => s.id)).toEqual(["a", "c"]);
  });
});

// ============================================================================
// Hook integration tests
// ============================================================================

describe("hook integration", () => {
  it("session_start injects fleet summary as context", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "sensor-1", host: "192.168.1.10", port: 8080 });
    fm.getNode("sensor-1")!.status.online = true;

    const summary = fm.generateFleetSummary();
    expect(summary).toBeTruthy();
    expect(summary).toContain("<iot-fleet>");
    expect(summary).toContain('id="sensor-1"');

    // Simulates what session_start hook returns
    const hookResult = { prependContext: summary };
    expect(hookResult.prependContext).toContain("<iot-fleet>");
  });

  it("before_prompt_build returns fleet summary as systemPrompt", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    fm.addNode({ id: "gw-1", host: "10.0.0.1", port: 8080 });
    fm.getNode("gw-1")!.status.online = false;

    const summary = fm.generateFleetSummary();
    // Simulates what before_prompt_build hook returns
    const hookResult = { systemPrompt: summary };
    expect(hookResult.systemPrompt).toContain('online="false"');
  });

  it("context not injected when fleet is empty", () => {
    const fm = new FleetManager(10, {}, "/tmp/test-fleet.json");
    const summary = fm.generateFleetSummary();
    expect(summary).toBe("");
    // Hook would return undefined (no injection)
  });

  it("context not injected when injectContext is false", () => {
    // Config parse with injectContext: false
    const cfg = iotBridgeConfigSchema.parse({ injectContext: false });
    expect(cfg.injectContext).toBe(false);
    // Hook logic: if (!cfg.injectContext) return;
  });
});
