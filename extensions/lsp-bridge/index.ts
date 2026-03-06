/**
 * Mayros LSP Bridge Plugin
 *
 * Cortex-backed language server bridge. Queries code-indexer triples
 * for hover/definition and stores diagnostics in Cortex.
 *
 * Tools: lsp_diagnostics, lsp_hover, lsp_definition, lsp_completions
 *
 * CLI: mayros lsp start|stop|status|diagnostics
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { lspBridgeConfigSchema } from "./config.js";
import { LspServerManager } from "./lsp-server-manager.js";
import { LspCortexBackend } from "./lsp-cortex-backend.js";
import { severityLabel, type LspDiagnostic } from "./lsp-protocol.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const lspBridgePlugin = {
  id: "lsp-bridge",
  name: "LSP Bridge",
  description:
    "Cortex-backed language server bridge — hover, diagnostics, go-to-definition via code-indexer triples",
  kind: "integration" as const,
  configSchema: lspBridgeConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = lspBridgeConfigSchema.parse(api.pluginConfig);
    const ns = cfg.namespace;
    const client = new CortexClient(cfg.cortex);
    const serverMgr = new LspServerManager();
    const backend = new LspCortexBackend(client, ns);

    let cortexAvailable = false;
    let diagnosticTimer: ReturnType<typeof setInterval> | undefined;

    api.logger.info(`lsp-bridge: registered (ns: ${ns}, servers: ${cfg.servers.length})`);

    // ========================================================================
    // Helpers
    // ========================================================================

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    // ========================================================================
    // Tools
    // ========================================================================

    // 1. lsp_diagnostics
    api.registerTool(
      {
        name: "lsp_diagnostics",
        label: "LSP Diagnostics",
        description: "Get diagnostics (errors, warnings) for a file or all files.",
        parameters: Type.Object({
          uri: Type.Optional(
            Type.String({
              description: "File URI (e.g., file:///src/index.ts). Shows all if omitted.",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { uri } = params as { uri?: string };

          // Try live server first, fall back to Cortex
          if (uri) {
            for (const config of cfg.servers) {
              if (serverMgr.isRunning(config.language)) {
                try {
                  const result = await serverMgr.sendRequest(
                    config.language,
                    "textDocument/diagnostic",
                    { textDocument: { uri } },
                  );
                  if (
                    result &&
                    typeof result === "object" &&
                    "items" in (result as Record<string, unknown>)
                  ) {
                    const items = (result as { items: LspDiagnostic[] }).items;
                    const lines = items.map(
                      (d) =>
                        `  ${severityLabel(d.severity)}  L${d.range.start.line}:${d.range.start.character}  ${d.message}`,
                    );
                    return {
                      content: [
                        {
                          type: "text",
                          text: `${items.length} diagnostic(s) for ${uri}:\n\n${lines.join("\n")}`,
                        },
                      ],
                      details: { action: "diagnostics", source: "live", count: items.length },
                    };
                  }
                } catch {
                  // Fall through to Cortex
                }
              }
            }
          }

          // Fall back to Cortex backend
          if (await ensureCortex()) {
            try {
              const diagnostics = await backend.getDiagnostics(uri);
              if (diagnostics.length === 0) {
                return {
                  content: [{ type: "text", text: "No diagnostics found." }],
                  details: { action: "diagnostics", source: "cortex", count: 0 },
                };
              }

              const lines = diagnostics.map(
                (d) =>
                  `  ${d.uri}:${d.diagnostic.range.start.line}  [${severityLabel(d.diagnostic.severity)}]  ${d.diagnostic.message}`,
              );
              return {
                content: [
                  {
                    type: "text",
                    text: `${diagnostics.length} diagnostic(s):\n\n${lines.join("\n")}`,
                  },
                ],
                details: { action: "diagnostics", source: "cortex", count: diagnostics.length },
              };
            } catch (err) {
              return {
                content: [{ type: "text", text: `Error: ${String(err)}` }],
                details: { action: "failed", error: String(err) },
              };
            }
          }

          return {
            content: [{ type: "text", text: "No LSP server running and Cortex unavailable." }],
            details: { action: "failed", reason: "no_source" },
          };
        },
      },
      { name: "lsp_diagnostics" },
    );

    // 2. lsp_hover
    api.registerTool(
      {
        name: "lsp_hover",
        label: "LSP Hover",
        description: "Get hover information for a position in a file.",
        parameters: Type.Object({
          uri: Type.String({ description: "File URI" }),
          line: Type.Number({ description: "Line number (0-based)" }),
          character: Type.Number({ description: "Character offset (0-based)" }),
        }),
        async execute(_toolCallId, params) {
          const { uri, line, character } = params as {
            uri: string;
            line: number;
            character: number;
          };

          // Try live server
          for (const config of cfg.servers) {
            if (serverMgr.isRunning(config.language)) {
              try {
                const result = await serverMgr.sendRequest(config.language, "textDocument/hover", {
                  textDocument: { uri },
                  position: { line, character },
                });

                if (result && typeof result === "object") {
                  const hover = result as { contents?: unknown };
                  const contents =
                    typeof hover.contents === "string"
                      ? hover.contents
                      : typeof hover.contents === "object" && hover.contents !== null
                        ? JSON.stringify(hover.contents)
                        : "(no hover info)";

                  return {
                    content: [{ type: "text", text: contents }],
                    details: { action: "hover", source: "live", uri, line, character },
                  };
                }

                return {
                  content: [{ type: "text", text: "(no hover info)" }],
                  details: { action: "hover", source: "live", empty: true },
                };
              } catch {
                // Fall through
              }
            }
          }

          return {
            content: [{ type: "text", text: "No LSP server available for hover." }],
            details: { action: "failed", reason: "no_server" },
          };
        },
      },
      { name: "lsp_hover" },
    );

    // 3. lsp_definition
    api.registerTool(
      {
        name: "lsp_definition",
        label: "LSP Definition",
        description: "Go to definition of a symbol at a position.",
        parameters: Type.Object({
          uri: Type.String({ description: "File URI" }),
          line: Type.Number({ description: "Line number (0-based)" }),
          character: Type.Number({ description: "Character offset (0-based)" }),
          name: Type.Optional(Type.String({ description: "Symbol name (for Cortex fallback)" })),
        }),
        async execute(_toolCallId, params) {
          const { uri, line, character, name } = params as {
            uri: string;
            line: number;
            character: number;
            name?: string;
          };

          // Try live server
          for (const config of cfg.servers) {
            if (serverMgr.isRunning(config.language)) {
              try {
                const result = await serverMgr.sendRequest(
                  config.language,
                  "textDocument/definition",
                  {
                    textDocument: { uri },
                    position: { line, character },
                  },
                );

                if (result) {
                  const locations = Array.isArray(result) ? result : [result];
                  const lines = locations.map((loc: Record<string, unknown>) => {
                    const locUri = loc.uri ?? loc.targetUri ?? "";
                    const range = (loc.range ?? loc.targetRange ?? {}) as {
                      start?: { line: number; character: number };
                    };
                    return `  ${locUri}:${range.start?.line ?? 0}:${range.start?.character ?? 0}`;
                  });

                  return {
                    content: [
                      {
                        type: "text",
                        text: `${locations.length} definition(s):\n\n${lines.join("\n")}`,
                      },
                    ],
                    details: { action: "definition", source: "live", count: locations.length },
                  };
                }
              } catch {
                // Fall through to Cortex
              }
            }
          }

          // Fall back to Cortex code-indexer lookup
          if (name && (await ensureCortex())) {
            try {
              const def = await backend.lookupDefinition(name);
              if (def) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Definition found (Cortex):\n  ${def.path}:${def.line} [${def.type}]`,
                    },
                  ],
                  details: { action: "definition", source: "cortex", definition: def },
                };
              }
            } catch {
              // Fall through
            }
          }

          return {
            content: [{ type: "text", text: "Definition not found." }],
            details: { action: "not_found" },
          };
        },
      },
      { name: "lsp_definition" },
    );

    // 4. lsp_completions
    api.registerTool(
      {
        name: "lsp_completions",
        label: "LSP Completions",
        description: "Get completion suggestions at a position.",
        parameters: Type.Object({
          uri: Type.String({ description: "File URI" }),
          line: Type.Number({ description: "Line number (0-based)" }),
          character: Type.Number({ description: "Character offset (0-based)" }),
        }),
        async execute(_toolCallId, params) {
          const { uri, line, character } = params as {
            uri: string;
            line: number;
            character: number;
          };

          for (const config of cfg.servers) {
            if (serverMgr.isRunning(config.language)) {
              try {
                const result = await serverMgr.sendRequest(
                  config.language,
                  "textDocument/completion",
                  {
                    textDocument: { uri },
                    position: { line, character },
                  },
                );

                const items = Array.isArray(result)
                  ? result
                  : result &&
                      typeof result === "object" &&
                      "items" in (result as Record<string, unknown>)
                    ? (result as { items: unknown[] }).items
                    : [];

                const lines = (items as Array<{ label: string; detail?: string }>)
                  .slice(0, 20)
                  .map((item) => `  ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);

                return {
                  content: [
                    {
                      type: "text",
                      text:
                        items.length > 0
                          ? `${items.length} completion(s):\n\n${lines.join("\n")}`
                          : "No completions available.",
                    },
                  ],
                  details: { action: "completions", count: items.length },
                };
              } catch {
                // Fall through
              }
            }
          }

          return {
            content: [{ type: "text", text: "No LSP server available for completions." }],
            details: { action: "failed", reason: "no_server" },
          };
        },
      },
      { name: "lsp_completions" },
    );

    // ========================================================================
    // CLI: mayros lsp start|stop|status|diagnostics
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const lsp = program
          .command("lsp")
          .description("LSP bridge — start, stop, and query language servers");

        lsp
          .command("start")
          .description("Start LSP server(s)")
          .option("--language <lang>", "Start only this language server")
          .action(async (opts: { language?: string }) => {
            const targets = opts.language
              ? cfg.servers.filter((s) => s.language === opts.language)
              : cfg.servers;

            if (targets.length === 0) {
              console.log(
                opts.language
                  ? `No server configured for language: ${opts.language}`
                  : "No LSP servers configured.",
              );
              return;
            }

            for (const config of targets) {
              try {
                await serverMgr.start(config);
                console.log(`Started ${config.language} (${config.command})`);
              } catch (err) {
                console.log(`Failed to start ${config.language}: ${String(err)}`);
              }
            }
          });

        lsp
          .command("stop")
          .description("Stop LSP server(s)")
          .option("--language <lang>", "Stop only this language server")
          .action(async (opts: { language?: string }) => {
            if (opts.language) {
              await serverMgr.stop(opts.language);
              console.log(`Stopped ${opts.language}.`);
            } else {
              await serverMgr.stopAll();
              console.log("All LSP servers stopped.");
            }
          });

        lsp
          .command("status")
          .description("Show running LSP servers")
          .action(() => {
            const status = serverMgr.getStatus();
            if (status.length === 0) {
              console.log("No LSP servers active. Configured servers:");
              for (const s of cfg.servers) {
                console.log(`  ${s.language}: ${s.command} ${s.args.join(" ")}`);
              }
              return;
            }

            console.log(`LSP servers (${status.length}):`);
            for (const s of status) {
              const icon = s.running ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
              console.log(`  ${icon} ${s.language}: ${s.running ? "running" : "stopped"}`);
            }
          });

        lsp
          .command("diagnostics")
          .description("Show diagnostics from Cortex")
          .option("--file <f>", "Filter by file path or URI")
          .action(async (opts: { file?: string }) => {
            if (!(await ensureCortex())) {
              console.log("Cortex offline. Cannot retrieve diagnostics.");
              return;
            }

            const uri = opts.file?.startsWith("file://")
              ? opts.file
              : opts.file
                ? `file://${opts.file}`
                : undefined;

            try {
              const diagnostics = await backend.getDiagnostics(uri);
              if (diagnostics.length === 0) {
                console.log("No diagnostics found.");
                return;
              }

              console.log(`Diagnostics (${diagnostics.length}):`);
              for (const d of diagnostics) {
                const sev = severityLabel(d.diagnostic.severity);
                console.log(
                  `  ${d.uri}:${d.diagnostic.range.start.line}  [${sev}]  ${d.diagnostic.message}`,
                );
              }
            } catch (err) {
              console.log(`Error: ${String(err)}`);
            }
          });
      },
      { commands: ["lsp"] },
    );

    // ========================================================================
    // Hooks: session lifecycle
    // ========================================================================

    api.on("session_start", async () => {
      // Auto-start configured LSP servers
      for (const config of cfg.servers) {
        try {
          await serverMgr.start(config);
          api.logger.info(`lsp-bridge: started ${config.language}`);
        } catch (err) {
          api.logger.warn(`lsp-bridge: failed to start ${config.language}: ${String(err)}`);
        }
      }

      // Start periodic diagnostic sync
      if (cfg.diagnosticSyncIntervalMs > 0) {
        diagnosticTimer = setInterval(async () => {
          try {
            if (!(await ensureCortex())) return;

            // Query each running server for diagnostics and store in Cortex
            for (const config of cfg.servers) {
              if (!serverMgr.isRunning(config.language)) continue;
              // Diagnostic sync would require textDocument/diagnostic support
              // which varies by server. For now, diagnostics are stored
              // when published by the server via notifications.
            }
          } catch (err) {
            api.logger.warn(`lsp-bridge: diagnostic sync failed: ${String(err)}`);
          }
        }, cfg.diagnosticSyncIntervalMs);
      }
    });

    api.on("session_end", async () => {
      if (diagnosticTimer) {
        clearInterval(diagnosticTimer);
        diagnosticTimer = undefined;
      }
      await serverMgr.stopAll();
    });

    // ========================================================================
    // Service lifecycle
    // ========================================================================

    api.registerService({
      id: "lsp-bridge-lifecycle",
      async start() {
        // Servers are started on session_start
      },
      async stop() {
        if (diagnosticTimer) {
          clearInterval(diagnosticTimer);
          diagnosticTimer = undefined;
        }
        await serverMgr.stopAll();
        client.destroy();
      },
    });
  },
};

export default lspBridgePlugin;
