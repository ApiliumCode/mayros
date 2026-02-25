/**
 * IoT Bridge — Fleet orchestration: node registry, health polling, persistence, context generation.
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ResilienceConfig } from "../shared/cortex-resilience.js";
import type { IoTNodeConfig } from "./config.js";
import { IoTNodeClient } from "./iot-client.js";
import type { NodeStatus } from "./types.js";

function resolveTilde(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir();
    return join(home, p.slice(2));
  }
  return p;
}

type FleetEntry = {
  client: IoTNodeClient;
  status: NodeStatus;
};

export type PersistedFleet = {
  nodes: IoTNodeConfig[];
};

export class FleetManager {
  private readonly nodes = new Map<string, FleetEntry>();
  private readonly maxNodes: number;
  private readonly resilience: ResilienceConfig;
  private readonly persistPath: string;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(maxNodes: number, resilience: ResilienceConfig, persistPath: string) {
    this.maxNodes = maxNodes;
    this.resilience = resilience;
    this.persistPath = resolveTilde(persistPath);
  }

  // -------------------------------------------------------------------------
  // Node management
  // -------------------------------------------------------------------------

  addNode(config: IoTNodeConfig): void {
    if (this.nodes.has(config.id)) {
      throw new Error(`Node "${config.id}" already exists`);
    }
    if (this.nodes.size >= this.maxNodes) {
      throw new Error(`Fleet limit reached (${this.maxNodes})`);
    }
    const client = new IoTNodeClient(config.host, config.port, this.resilience);
    const status: NodeStatus = {
      id: config.id,
      label: config.label,
      host: config.host,
      port: config.port,
      online: false,
      lastCheckedMs: 0,
    };
    this.nodes.set(config.id, { client, status });
  }

  removeNode(id: string): boolean {
    return this.nodes.delete(id);
  }

  getNode(id: string): { client: IoTNodeClient; status: NodeStatus } | undefined {
    return this.nodes.get(id);
  }

  listNodes(): NodeStatus[] {
    return [...this.nodes.values()].map((e) => e.status);
  }

  onlineCount(): number {
    let count = 0;
    for (const e of this.nodes.values()) {
      if (e.status.online) count++;
    }
    return count;
  }

  offlineCount(): number {
    let count = 0;
    for (const e of this.nodes.values()) {
      if (!e.status.online) count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  async pollAll(): Promise<void> {
    const promises = [...this.nodes.keys()].map((id) => this.pollNode(id));
    await Promise.allSettled(promises);
  }

  async pollNode(id: string): Promise<NodeStatus> {
    const entry = this.nodes.get(id);
    if (!entry) {
      throw new Error(`Unknown node: ${id}`);
    }

    try {
      const healthy = await entry.client.isHealthy();
      entry.status.online = healthy;
      entry.status.lastCheckedMs = Date.now();
      entry.status.error = undefined;

      if (healthy) {
        try {
          entry.status.info = await entry.client.getInfo();
        } catch {
          // info is optional enrichment
        }
        try {
          entry.status.stats = await entry.client.getStats();
        } catch {
          // stats is optional enrichment
        }
      }
    } catch (err) {
      entry.status.online = false;
      entry.status.lastCheckedMs = Date.now();
      entry.status.error = String(err);
    }

    return entry.status;
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.pollAll();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async loadFleet(): Promise<void> {
    try {
      const raw = await readFile(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Partial<PersistedFleet>;
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      for (const n of nodes) {
        if (n && typeof n === "object" && typeof n.id === "string" && typeof n.host === "string") {
          if (!this.nodes.has(n.id)) {
            try {
              this.addNode({
                id: n.id,
                host: n.host,
                port: typeof n.port === "number" ? n.port : 8080,
                label: typeof n.label === "string" ? n.label : undefined,
              });
            } catch {
              // skip invalid or over-limit
            }
          }
        }
      }
    } catch {
      // no persisted fleet — fine
    }
  }

  async saveFleet(): Promise<void> {
    const configs: IoTNodeConfig[] = [];
    for (const entry of this.nodes.values()) {
      configs.push({
        id: entry.status.id,
        host: entry.status.host,
        port: entry.status.port,
        label: entry.status.label,
      });
    }
    const data: PersistedFleet = { nodes: configs };
    const dir = dirname(this.persistPath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.iot-fleet-${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, this.persistPath);
  }

  // -------------------------------------------------------------------------
  // Context generation
  // -------------------------------------------------------------------------

  generateFleetSummary(): string {
    const statuses = this.listNodes();
    if (statuses.length === 0) return "";

    const lines: string[] = ["<iot-fleet>"];
    for (const s of statuses) {
      const attrs = [`id="${s.id}"`, `host="${s.host}:${s.port}"`, `online="${s.online}"`];
      if (s.label) attrs.push(`label="${s.label}"`);
      if (s.info) {
        attrs.push(`version="${s.info.version}"`);
        attrs.push(`entries="${s.info.entries_count}"`);
        attrs.push(`peers="${s.info.peers_count}"`);
      }
      if (s.stats) {
        attrs.push(`gossip_rounds="${s.stats.gossip_rounds}"`);
        attrs.push(`storage_used="${s.stats.storage_used}"`);
      }
      lines.push(`  <node ${attrs.join(" ")} />`);
    }
    lines.push("</iot-fleet>");
    return lines.join("\n");
  }
}
