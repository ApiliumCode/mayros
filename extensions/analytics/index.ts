import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { createEvent } from "./event-schema.js";
import { EventQueue, anonymize } from "./event-queue.js";
import { parseAnalyticsConfig, isAnalyticsEnabled } from "./config.js";

const analyticsPlugin = {
  id: "analytics",
  name: "Analytics",
  description: "Opt-in usage analytics with privacy controls and batch event delivery",
  kind: "observability" as const,

  async register(api: MayrosPluginApi) {
    const cfg = parseAnalyticsConfig(api.pluginConfig);

    if (!isAnalyticsEnabled(cfg)) {
      api.logger.info("analytics: disabled (opt-in required or MAYROS_ANALYTICS_DISABLED=1)");
      return;
    }

    let currentSessionId: string | undefined;
    const version = api.version ?? "0.0.0";

    const queue = new EventQueue({
      maxBufferSize: cfg.maxBufferSize,
      flushIntervalMs: cfg.flushIntervalMs,
      eventTtlMs: cfg.eventTtlMs,
      clientVersion: version,
      onFlush: async (batch) => {
        // Log batch locally — delivery to external endpoint is optional
        api.logger.info(`analytics: flushed ${batch.events.length} events`);
        // Future: POST to analytics endpoint
        // await fetch("https://analytics.apilium.com/batch", { method: "POST", body: JSON.stringify(batch) });
      },
    });

    const sessionHash = (id: string) => (cfg.privacyMode === "anonymous" ? anonymize(id) : id);

    // ========================================================================
    // Hooks
    // ========================================================================

    api.on("session_start", async (_event, ctx) => {
      currentSessionId = sessionHash(ctx?.sessionId ?? "unknown");
      queue.start();
      queue.enqueue(createEvent("session", "start", { sessionId: currentSessionId }));
    });

    api.on("session_end", async () => {
      queue.enqueue(createEvent("session", "end", { sessionId: currentSessionId }));
      await queue.stop();
    });

    api.on("after_tool_call", async (event) => {
      queue.enqueue(
        createEvent("tool", "execute", {
          label: event.toolName,
          value: event.durationMs,
          sessionId: currentSessionId,
          attributes: {
            success: !event.error,
          },
        }),
      );
    });

    api.on("llm_output", async (event) => {
      const usage = event.usage as Record<string, number> | undefined;
      queue.enqueue(
        createEvent("model", "response", {
          label: event.model,
          value: usage?.total,
          sessionId: currentSessionId,
          attributes: {
            provider: event.provider ?? "unknown",
            inputTokens: usage?.input ?? 0,
            outputTokens: usage?.output ?? 0,
          },
        }),
      );
    });

    // ========================================================================
    // Tools
    // ========================================================================

    const { Type } = await import("@sinclair/typebox");

    api.registerTool(
      {
        name: "analytics_status",
        label: "Analytics Status",
        description: "Show analytics queue status: buffer size, flush stats, privacy mode.",
        parameters: Type.Object({}),
        async execute() {
          const lines = [
            `Analytics: ${cfg.enabled ? "enabled" : "disabled"}`,
            `Privacy:   ${cfg.privacyMode}`,
            `Buffer:    ${queue.getBufferSize()} events`,
            `Failures:  ${queue.getFailureCount()} consecutive`,
            `Flush:     every ${cfg.flushIntervalMs / 1000}s`,
          ];
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              enabled: cfg.enabled,
              privacyMode: cfg.privacyMode,
              bufferSize: queue.getBufferSize(),
              failures: queue.getFailureCount(),
            },
          };
        },
      },
      { name: "analytics_status" },
    );

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const analytics = program.command("analytics").description("Analytics management");

        analytics
          .command("status")
          .description("Show analytics status")
          .action(() => {
            console.log(`Analytics: ${cfg.enabled ? "enabled" : "disabled"}`);
            console.log(`Privacy:   ${cfg.privacyMode}`);
            console.log(`Buffer:    ${queue.getBufferSize()} events`);
            console.log(`Failures:  ${queue.getFailureCount()}`);
          });

        analytics
          .command("flush")
          .description("Force-flush buffered events")
          .action(async () => {
            const before = queue.getBufferSize();
            await queue.flush();
            console.log(`Flushed ${before} events.`);
          });
      },
      { commands: ["analytics"] },
    );

    api.logger.info(
      `analytics: registered (privacy=${cfg.privacyMode}, buffer=${cfg.maxBufferSize}, flush=${cfg.flushIntervalMs}ms)`,
    );
  },
};

export default analyticsPlugin;
