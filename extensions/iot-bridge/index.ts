/**
 * IoT Bridge Plugin
 *
 * Connects MAYROS agents to aingle_minimal IoT nodes via REST.
 * Provides fleet management, sensor data context injection,
 * and tools for agents to interact with edge devices.
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { iotBridgeConfigSchema } from "./config.js";
import { FleetManager } from "./fleet-manager.js";
import type { ObservationPayload } from "./types.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const iotBridgePlugin = {
  id: "iot-bridge",
  name: "IoT Bridge",
  description: "Connect MAYROS agents to aingle_minimal IoT nodes via REST",
  kind: "iot" as const,
  configSchema: iotBridgeConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = iotBridgeConfigSchema.parse(api.pluginConfig);
    const fleet = new FleetManager(cfg.maxNodes, cfg.resilience, cfg.fleetPersistPath);

    api.logger.info(
      `iot-bridge: registered (maxNodes: ${cfg.maxNodes}, poll: ${cfg.pollIntervalMs}ms)`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "iot_node_info",
        label: "IoT Node Info",
        description:
          "Get information about an IoT node (version, uptime, entries, peers, features).",
        parameters: Type.Object({
          nodeId: Type.String({ description: "Node ID from the fleet" }),
        }),
        async execute(_toolCallId, params) {
          const { nodeId } = params as { nodeId: string };
          const entry = fleet.getNode(nodeId);
          if (!entry) {
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown node: "${nodeId}". Use iot_list_fleet to see available nodes.`,
                },
              ],
              details: { error: "unknown_node" },
            };
          }

          try {
            const info = await entry.client.getInfo();
            const lines = [
              `Node: ${nodeId} (${entry.status.host}:${entry.status.port})`,
              `  version: ${info.version}`,
              `  node_id: ${info.node_id}`,
              `  uptime: ${info.uptime_secs}s`,
              `  entries: ${info.entries_count}`,
              `  peers: ${info.peers_count}`,
              `  storage: ${info.storage_backend}`,
              `  features: ${info.features.join(", ") || "none"}`,
            ];
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { info },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `Failed to get info for "${nodeId}": ${String(err)}` },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "iot_node_info" },
    );

    api.registerTool(
      {
        name: "iot_node_stats",
        label: "IoT Node Stats",
        description: "Get statistics for an IoT node (storage, gossip, sync).",
        parameters: Type.Object({
          nodeId: Type.String({ description: "Node ID from the fleet" }),
        }),
        async execute(_toolCallId, params) {
          const { nodeId } = params as { nodeId: string };
          const entry = fleet.getNode(nodeId);
          if (!entry) {
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown node: "${nodeId}". Use iot_list_fleet to see available nodes.`,
                },
              ],
              details: { error: "unknown_node" },
            };
          }

          try {
            const stats = await entry.client.getStats();
            const lines = [
              `Node: ${nodeId} (${entry.status.host}:${entry.status.port})`,
              `  entries: ${stats.entries_count}`,
              `  actions: ${stats.actions_count}`,
              `  storage_used: ${stats.storage_used} bytes`,
              `  peers: ${stats.peer_count}`,
              `  uptime: ${stats.uptime_secs}s`,
              `  gossip_rounds: ${stats.gossip_rounds}`,
              `  sync_success: ${stats.sync_success}`,
              `  sync_failed: ${stats.sync_failed}`,
            ];
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { stats },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `Failed to get stats for "${nodeId}": ${String(err)}` },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "iot_node_stats" },
    );

    api.registerTool(
      {
        name: "iot_list_fleet",
        label: "IoT List Fleet",
        description: "List all IoT nodes in the fleet with their status.",
        parameters: Type.Object({
          onlineOnly: Type.Optional(
            Type.Boolean({ description: "If true, only show online nodes" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { onlineOnly } = params as { onlineOnly?: boolean };
          let statuses = fleet.listNodes();
          if (onlineOnly) {
            statuses = statuses.filter((s) => s.online);
          }

          if (statuses.length === 0) {
            return {
              content: [
                { type: "text", text: onlineOnly ? "No online nodes." : "Fleet is empty." },
              ],
              details: { count: 0 },
            };
          }

          const lines = statuses.map((s) => {
            const status = s.online ? "ONLINE" : "OFFLINE";
            const label = s.label ? ` (${s.label})` : "";
            return `  ${s.id}${label} — ${s.host}:${s.port} [${status}]`;
          });

          return {
            content: [
              {
                type: "text",
                text: `Fleet: ${statuses.length} node(s) (${fleet.onlineCount()} online, ${fleet.offlineCount()} offline)\n${lines.join("\n")}`,
              },
            ],
            details: { count: statuses.length, nodes: statuses },
          };
        },
      },
      { name: "iot_list_fleet" },
    );

    api.registerTool(
      {
        name: "iot_publish_entry",
        label: "IoT Publish Entry",
        description: "Create a DAG entry on an IoT node.",
        parameters: Type.Object({
          nodeId: Type.String({ description: "Node ID from the fleet" }),
          data: Type.Unknown({ description: "Entry data payload" }),
        }),
        async execute(_toolCallId, params) {
          const { nodeId, data } = params as { nodeId: string; data: unknown };
          const entry = fleet.getNode(nodeId);
          if (!entry) {
            return {
              content: [{ type: "text", text: `Unknown node: "${nodeId}".` }],
              details: { error: "unknown_node" },
            };
          }

          try {
            const result = await entry.client.createEntry(data);
            return {
              content: [
                {
                  type: "text",
                  text: `Entry published to "${nodeId}":\n  hash: ${result.hash}\n  seq: ${result.seq}\n  timestamp: ${result.timestamp}`,
                },
              ],
              details: { result },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `Failed to publish entry to "${nodeId}": ${String(err)}` },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "iot_publish_entry" },
    );

    api.registerTool(
      {
        name: "iot_get_entry",
        label: "IoT Get Entry",
        description: "Retrieve a DAG entry by hash from an IoT node.",
        parameters: Type.Object({
          nodeId: Type.String({ description: "Node ID from the fleet" }),
          hash: Type.String({ description: "Entry hash" }),
        }),
        async execute(_toolCallId, params) {
          const { nodeId, hash } = params as { nodeId: string; hash: string };
          const entry = fleet.getNode(nodeId);
          if (!entry) {
            return {
              content: [{ type: "text", text: `Unknown node: "${nodeId}".` }],
              details: { error: "unknown_node" },
            };
          }

          try {
            const result = await entry.client.getEntry(hash);
            if (!result) {
              return {
                content: [{ type: "text", text: `Entry not found: ${hash}` }],
                details: { found: false },
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Entry from "${nodeId}":\n  hash: ${result.hash}\n  type: ${result.entry_type}\n  size: ${result.size}\n  content: ${JSON.stringify(result.content)}`,
                },
              ],
              details: { found: true, entry: result },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `Failed to get entry from "${nodeId}": ${String(err)}` },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "iot_get_entry" },
    );

    api.registerTool(
      {
        name: "iot_send_observation",
        label: "IoT Send Observation",
        description: "Forward a HOPE observation to a SmartNode via POST /api/v1/entries.",
        parameters: Type.Object({
          nodeId: Type.String({ description: "Node ID from the fleet" }),
          sensorType: Type.String({
            description: "Sensor/observation type (e.g. temperature, humidity)",
          }),
          value: Type.Number({ description: "Observation value" }),
          confidence: Type.Optional(Type.Number({ description: "Confidence level (0-1)" })),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), { description: "Additional metadata" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { nodeId, sensorType, value, confidence, metadata } = params as {
            nodeId: string;
            sensorType: string;
            value: number;
            confidence?: number;
            metadata?: Record<string, unknown>;
          };

          const entry = fleet.getNode(nodeId);
          if (!entry) {
            return {
              content: [{ type: "text", text: `Unknown node: "${nodeId}".` }],
              details: { error: "unknown_node" },
            };
          }

          const payload: ObservationPayload = {
            type: "observation",
            obs_type: sensorType,
            value,
            timestamp: Date.now(),
            confidence,
            metadata,
          };

          try {
            const result = await entry.client.sendObservation(payload);
            return {
              content: [
                {
                  type: "text",
                  text: `Observation sent to "${nodeId}":\n  type: ${sensorType}\n  value: ${value}\n  hash: ${result.hash}\n  seq: ${result.seq}`,
                },
              ],
              details: { result, payload },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `Failed to send observation to "${nodeId}": ${String(err)}` },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "iot_send_observation" },
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    api.on("session_start", async (_event, _ctx) => {
      // Load persisted fleet
      await fleet.loadFleet();

      // Merge static nodes from config (addNode skips duplicates)
      for (const nodeCfg of cfg.nodes) {
        try {
          fleet.addNode(nodeCfg);
        } catch {
          // already exists or over limit
        }
      }

      // Initial poll
      await fleet.pollAll();

      // Start background polling
      fleet.startPolling(cfg.pollIntervalMs);

      api.logger.info(
        `iot-bridge: fleet loaded (${fleet.onlineCount()} online, ${fleet.offlineCount()} offline)`,
      );
    });

    api.on("before_prompt_build", async (_event, _ctx) => {
      if (!cfg.injectContext) return;
      const summary = fleet.generateFleetSummary();
      if (summary) {
        return { prependContext: summary };
      }
    });

    api.on("session_end", async (_event, _ctx) => {
      fleet.stopPolling();
      await fleet.saveFleet();
      api.logger.info("iot-bridge: fleet persisted, polling stopped");
    });

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const iot = program.command("iot").description("IoT fleet management commands");

        iot
          .command("fleet")
          .description("List all IoT nodes with status")
          .action(async () => {
            const statuses = fleet.listNodes();
            if (statuses.length === 0) {
              console.log("Fleet is empty. Use `mayros iot add <host>` to add a node.");
              return;
            }

            console.log(`Fleet: ${statuses.length} node(s)\n`);
            console.log("  ID                 HOST              STATUS   LABEL");
            console.log("  ─────────────────  ────────────────  ───────  ─────");
            for (const s of statuses) {
              const id = s.id.padEnd(19);
              const host = `${s.host}:${s.port}`.padEnd(16);
              const status = s.online ? "ONLINE " : "OFFLINE";
              const label = s.label ?? "";
              console.log(`  ${id}  ${host}  ${status}  ${label}`);
            }
            console.log(`\n  Online: ${fleet.onlineCount()}  Offline: ${fleet.offlineCount()}`);
          });

        iot
          .command("add")
          .description("Add an IoT node to the fleet")
          .argument("<host>", "Node hostname or IP")
          .option("--port <port>", "Node port", "8080")
          .option("--id <id>", "Node ID (defaults to host with dots replaced by hyphens)")
          .option("--label <label>", "Human-friendly label")
          .action(async (host: string, opts: { port: string; id?: string; label?: string }) => {
            const port = parseInt(opts.port, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
              console.error("Invalid port number.");
              return;
            }

            const id = opts.id ?? host.replace(/\./g, "-");

            try {
              fleet.addNode({ id, host, port, label: opts.label });
              await fleet.saveFleet();
              console.log(`Added node "${id}" (${host}:${port})`);

              // Quick health check
              const status = await fleet.pollNode(id);
              console.log(`  Status: ${status.online ? "ONLINE" : "OFFLINE"}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        iot
          .command("remove")
          .description("Remove an IoT node from the fleet")
          .argument("<id>", "Node ID")
          .action(async (id: string) => {
            if (fleet.removeNode(id)) {
              await fleet.saveFleet();
              console.log(`Removed node "${id}".`);
            } else {
              console.error(`Node "${id}" not found.`);
            }
          });

        iot
          .command("status")
          .description("Detailed status for an IoT node (info + stats + peers)")
          .argument("<id>", "Node ID")
          .action(async (id: string) => {
            const entry = fleet.getNode(id);
            if (!entry) {
              console.error(`Node "${id}" not found.`);
              return;
            }

            const status = await fleet.pollNode(id);
            console.log(`Node: ${id} (${status.host}:${status.port})`);
            console.log(`  Status: ${status.online ? "ONLINE" : "OFFLINE"}`);
            if (status.label) console.log(`  Label: ${status.label}`);

            if (status.info) {
              console.log(`  Version: ${status.info.version}`);
              console.log(`  Node ID: ${status.info.node_id}`);
              console.log(`  Uptime: ${status.info.uptime_secs}s`);
              console.log(`  Entries: ${status.info.entries_count}`);
              console.log(`  Peers: ${status.info.peers_count}`);
              console.log(`  Storage: ${status.info.storage_backend}`);
              console.log(`  Features: ${status.info.features.join(", ") || "none"}`);
            }

            if (status.stats) {
              console.log(`  Actions: ${status.stats.actions_count}`);
              console.log(`  Storage used: ${status.stats.storage_used} bytes`);
              console.log(`  Gossip rounds: ${status.stats.gossip_rounds}`);
              console.log(
                `  Sync: ${status.stats.sync_success} ok / ${status.stats.sync_failed} failed`,
              );
            }

            if (!status.online && status.error) {
              console.log(`  Error: ${status.error}`);
            }

            // Fetch peers if online
            if (status.online) {
              try {
                const peers = await entry.client.getPeers();
                if (peers.length > 0) {
                  console.log(`  Peers:`);
                  for (const p of peers) {
                    console.log(
                      `    ${p.addr} (quality: ${p.quality}, seq: ${p.latest_seq}, seen: ${p.last_seen_secs}s ago)`,
                    );
                  }
                }
              } catch {
                // peers fetch is optional
              }
            }
          });

        iot
          .command("ping")
          .description("Quick health check with latency")
          .argument("<id>", "Node ID")
          .action(async (id: string) => {
            const entry = fleet.getNode(id);
            if (!entry) {
              console.error(`Node "${id}" not found.`);
              return;
            }

            const start = Date.now();
            const healthy = await entry.client.isHealthy();
            const latency = Date.now() - start;

            if (healthy) {
              console.log(`${id}: PONG (${latency}ms)`);
            } else {
              console.log(`${id}: UNREACHABLE (${latency}ms)`);
            }
          });
      },
      { commands: ["iot"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "iot-bridge",
      async start() {
        api.logger.info("iot-bridge: service started");
      },
      async stop() {
        fleet.stopPolling();
        await fleet.saveFleet();
        api.logger.info("iot-bridge: service stopped, fleet persisted");
      },
    });
  },
};

export default iotBridgePlugin;
