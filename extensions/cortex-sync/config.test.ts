/**
 * Tests for cortex-sync configuration parsing, including P2P bridge (B3).
 */

import { describe, expect, it } from "vitest";
import { parseCortexSyncConfig, type CortexSyncConfig } from "./config.js";

describe("parseCortexSyncConfig", () => {
  it("returns defaults for empty input", () => {
    const cfg = parseCortexSyncConfig({});
    expect(cfg.namespace).toBe("mayros");
    expect(cfg.sync.intervalSeconds).toBe(300);
    expect(cfg.sync.autoSync).toBe(false);
    expect(cfg.sync.conflictStrategy).toBe("last-writer-wins");
    expect(cfg.sync.maxTriplesPerSync).toBe(5000);
    expect(cfg.sync.syncTimeoutMs).toBe(30000);
    expect(cfg.sync.nativeP2pPreferred).toBe(true);
    expect(cfg.discovery.bonjourEnabled).toBe(false);
    expect(cfg.discovery.manualPeers).toEqual([]);
  });

  it("nativeP2pPreferred defaults to true", () => {
    const cfg = parseCortexSyncConfig({});
    expect(cfg.sync.nativeP2pPreferred).toBe(true);
  });

  it("nativeP2pPreferred can be set to false", () => {
    const cfg = parseCortexSyncConfig({
      sync: { nativeP2pPreferred: false },
    });
    expect(cfg.sync.nativeP2pPreferred).toBe(false);
  });

  it("nativeP2pPreferred true is respected", () => {
    const cfg = parseCortexSyncConfig({
      sync: { nativeP2pPreferred: true },
    });
    expect(cfg.sync.nativeP2pPreferred).toBe(true);
  });

  it("clamps intervalSeconds to range", () => {
    const cfg1 = parseCortexSyncConfig({ sync: { intervalSeconds: 1 } });
    expect(cfg1.sync.intervalSeconds).toBe(10);

    const cfg2 = parseCortexSyncConfig({ sync: { intervalSeconds: 100000 } });
    expect(cfg2.sync.intervalSeconds).toBe(86400);
  });

  it("clamps maxTriplesPerSync to range", () => {
    const cfg1 = parseCortexSyncConfig({ sync: { maxTriplesPerSync: 1 } });
    expect(cfg1.sync.maxTriplesPerSync).toBe(100);

    const cfg2 = parseCortexSyncConfig({ sync: { maxTriplesPerSync: 100000 } });
    expect(cfg2.sync.maxTriplesPerSync).toBe(50000);
  });

  it("parses valid conflictStrategy", () => {
    const cfg = parseCortexSyncConfig({
      sync: { conflictStrategy: "keep-both" },
    });
    expect(cfg.sync.conflictStrategy).toBe("keep-both");
  });

  it("falls back to default for invalid conflictStrategy", () => {
    const cfg = parseCortexSyncConfig({
      sync: { conflictStrategy: "invalid" },
    });
    expect(cfg.sync.conflictStrategy).toBe("last-writer-wins");
  });

  it("parses manual peers", () => {
    const cfg = parseCortexSyncConfig({
      discovery: {
        manualPeers: [
          {
            nodeId: "node1",
            endpoint: "http://localhost:8080",
            namespaces: ["ns1"],
            enabled: true,
          },
        ],
      },
    });
    expect(cfg.discovery.manualPeers).toHaveLength(1);
    expect(cfg.discovery.manualPeers[0].nodeId).toBe("node1");
  });

  it("filters invalid manual peers (missing nodeId or endpoint)", () => {
    const cfg = parseCortexSyncConfig({
      discovery: {
        manualPeers: [
          { nodeId: "", endpoint: "http://localhost:8080" },
          { nodeId: "valid", endpoint: "" },
          { nodeId: "ok", endpoint: "http://valid" },
        ],
      },
    });
    expect(cfg.discovery.manualPeers).toHaveLength(1);
    expect(cfg.discovery.manualPeers[0].nodeId).toBe("ok");
  });

  it("rejects unknown sync keys", () => {
    expect(() => parseCortexSyncConfig({ sync: { bogus: true } })).toThrow("unknown keys");
  });
});
