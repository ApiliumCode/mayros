/**
 * Semantic Observability Plugin Tests
 *
 * Tests cover:
 * - Configuration parsing and validation
 * - TraceEmitter: emit methods, buffer, UUID generation
 * - DecisionGraph: buildFromSession, explainAction
 * - ObservabilityQueryEngine: aggregateStats
 * - ObservabilityFormatter: terminal and markdown output
 * - Plugin registration metadata
 */

import { describe, test, expect } from "vitest";
import { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Config Tests
// ============================================================================

describe("observability config", () => {
  test("parses valid config with defaults", async () => {
    const { default: plugin } = await import("./index.js");

    const config = plugin.configSchema?.parse?.({});

    expect(config).toBeDefined();
    expect(config?.cortex?.host).toBe("127.0.0.1");
    expect(config?.cortex?.port).toBe(19090);
    expect(config?.agentNamespace).toBe("mayros");
    expect(config?.tracing?.enabled).toBe(true);
    expect(config?.tracing?.captureToolCalls).toBe(true);
    expect(config?.tracing?.captureLLMCalls).toBe(true);
    expect(config?.tracing?.captureDelegations).toBe(true);
    expect(config?.tracing?.flushIntervalMs).toBe(5000);
  });

  test("parses full config", async () => {
    const { default: plugin } = await import("./index.js");

    const config = plugin.configSchema?.parse?.({
      cortex: {
        host: "10.0.0.1",
        port: 9090,
      },
      agentNamespace: "test",
      tracing: {
        enabled: false,
        captureToolCalls: false,
        captureLLMCalls: false,
        captureDelegations: false,
        flushIntervalMs: 10000,
      },
    });

    expect(config?.cortex?.host).toBe("10.0.0.1");
    expect(config?.cortex?.port).toBe(9090);
    expect(config?.agentNamespace).toBe("test");
    expect(config?.tracing?.enabled).toBe(false);
    expect(config?.tracing?.captureToolCalls).toBe(false);
    expect(config?.tracing?.captureLLMCalls).toBe(false);
    expect(config?.tracing?.captureDelegations).toBe(false);
    expect(config?.tracing?.flushIntervalMs).toBe(10000);
  });

  test("rejects invalid port range", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        cortex: { port: 0 },
      });
    }).toThrow("cortex.port must be between 1 and 65535");
  });

  test("rejects port above 65535", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        cortex: { port: 70000 },
      });
    }).toThrow("cortex.port must be between 1 and 65535");
  });

  test("rejects unknown config keys", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        unknownKey: true,
      });
    }).toThrow("unknown keys");
  });

  test("rejects unknown cortex keys", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        cortex: { badKey: true },
      });
    }).toThrow("unknown keys");
  });

  test("rejects unknown tracing keys", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        tracing: { badKey: true },
      });
    }).toThrow("unknown keys");
  });

  test("rejects invalid namespace", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        agentNamespace: "123-bad",
      });
    }).toThrow("agentNamespace must start with a letter");
  });

  test("resolves env vars in auth token", async () => {
    const { default: plugin } = await import("./index.js");

    process.env.TEST_OBS_CORTEX_TOKEN = "obs-secret-token";

    const config = plugin.configSchema?.parse?.({
      cortex: { authToken: "${TEST_OBS_CORTEX_TOKEN}" },
    });

    expect(config?.cortex?.authToken).toBe("obs-secret-token");

    delete process.env.TEST_OBS_CORTEX_TOKEN;
  });

  test("throws on missing env var", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        cortex: { authToken: "${NONEXISTENT_OBS_VAR}" },
      });
    }).toThrow("Environment variable NONEXISTENT_OBS_VAR is not set");
  });

  test("rejects too-low flush interval", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        tracing: { flushIntervalMs: 50 },
      });
    }).toThrow("tracing.flushIntervalMs must be at least 100");
  });
});

// ============================================================================
// Plugin Registration Tests
// ============================================================================

describe("semantic observability plugin registration", () => {
  test("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("semantic-observability");
    expect(plugin.name).toBe("Semantic Observability");
    expect(plugin.kind).toBe("observability");
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.register).toBeInstanceOf(Function);
  });

  test("plugin description mentions tracing", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.description).toContain("tracing");
  });
});

// ============================================================================
// TraceEmitter Tests
// ============================================================================

describe("trace emitter", () => {
  test("emitToolCall returns a UUID", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );
    const id = emitter.emitToolCall("agent-1", "read_file", { path: "/foo" }, "contents", 42);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("emitLLMCall returns a UUID", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );
    const id = emitter.emitLLMCall("agent-1", "claude-3", 100, 200, 500);

    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  test("emitDecision returns a UUID", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );
    const id = emitter.emitDecision(
      "agent-1",
      "Choose deployment target",
      ["staging", "production"],
      "staging",
      "Less risky for first deploy",
    );

    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  test("emitDelegation returns a UUID", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );
    const id = emitter.emitDelegation("parent-1", "child-1", "review code", "run-123");

    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  test("emitError returns a UUID", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );
    const id = emitter.emitError("agent-1", "Connection timeout", "cortex health check");

    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  test("buffer accumulates events", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );

    expect(emitter.bufferedCount).toBe(0);

    emitter.emitToolCall("agent-1", "tool1", {}, {}, 10);
    expect(emitter.bufferedCount).toBe(1);

    emitter.emitLLMCall("agent-1", "model", 10, 20, 100);
    expect(emitter.bufferedCount).toBe(2);

    emitter.emitDecision("agent-1", "desc", ["a", "b"], "a");
    expect(emitter.bufferedCount).toBe(3);

    emitter.emitDelegation("p", "c", "task", "run");
    expect(emitter.bufferedCount).toBe(4);

    emitter.emitError("agent-1", "err");
    expect(emitter.bufferedCount).toBe(5);
  });

  test("getBufferedEvents returns copy of buffer", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
      5000,
    );

    emitter.emitToolCall("agent-1", "read_file", { path: "/a" }, "data", 15);
    emitter.emitError("agent-1", "some error");

    const events = emitter.getBufferedEvents();
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("tool_call");
    expect(events[0].fields.toolName).toBe("read_file");
    expect(events[1].type).toBe("error");
    expect(events[1].fields.error).toBe("some error");
  });

  test("emitted events have correct structure", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "myns",
      5000,
    );

    emitter.emitToolCall("agent-1", "search", { q: "test" }, { results: [] }, 25);

    const events = emitter.getBufferedEvents();
    const evt = events[0];

    expect(evt.id).toBeDefined();
    expect(evt.type).toBe("tool_call");
    expect(evt.agentId).toBe("agent-1");
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evt.durationMs).toBe(25);
    expect(evt.fields.toolName).toBe("search");
    expect(evt.fields.input).toBe('{"q":"test"}');
    expect(evt.fields.output).toBe('{"results":[]}');
  });

  test("emitLLMCall stores token counts as strings", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "ns",
      5000,
    );
    emitter.emitLLMCall("agent-1", "claude-opus", 150, 300, 1200);

    const events = emitter.getBufferedEvents();
    const evt = events[0];

    expect(evt.fields.model).toBe("claude-opus");
    expect(evt.fields.promptTokens).toBe("150");
    expect(evt.fields.completionTokens).toBe("300");
    expect(evt.fields.totalTokens).toBe("450");
  });

  test("emitDecision includes reasoning when provided", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "ns",
      5000,
    );
    emitter.emitDecision("agent-1", "pick framework", ["react", "vue"], "react", "more ecosystem");

    const events = emitter.getBufferedEvents();
    expect(events[0].fields.reasoning).toBe("more ecosystem");
  });

  test("emitDecision omits reasoning when not provided", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "ns",
      5000,
    );
    emitter.emitDecision("agent-1", "pick db", ["pg", "mysql"], "pg");

    const events = emitter.getBufferedEvents();
    expect(events[0].fields.reasoning).toBeUndefined();
  });

  test("emitError includes context when provided", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "ns",
      5000,
    );
    emitter.emitError("agent-1", "timeout", "health check");

    const events = emitter.getBufferedEvents();
    expect(events[0].fields.context).toBe("health check");
  });

  test("emitError omits context when not provided", async () => {
    const { TraceEmitter } = await import("./trace-emitter.js");

    const emitter = new TraceEmitter(
      new CortexClient({ host: "localhost", port: 9999 }),
      "ns",
      5000,
    );
    emitter.emitError("agent-1", "timeout");

    const events = emitter.getBufferedEvents();
    expect(events[0].fields.context).toBeUndefined();
  });
});

// ============================================================================
// DecisionGraph Tests
// ============================================================================

describe("decision graph", () => {
  test("constructs without error", async () => {
    const { DecisionGraph } = await import("./decision-graph.js");

    const graph = new DecisionGraph(new CortexClient({ host: "localhost", port: 9999 }), "test");
    expect(graph).toBeDefined();
  });

  test("buildFromSession returns empty tree for unreachable cortex", async () => {
    const { DecisionGraph } = await import("./decision-graph.js");

    const graph = new DecisionGraph(new CortexClient({ host: "localhost", port: 19999 }), "test");
    const tree = await graph.buildFromSession("session-1");

    expect(tree.rootEventId).toBe("");
    expect(tree.events).toEqual([]);
    expect(tree.depth).toBe(0);
  });

  test("queryEvents returns empty array for unreachable cortex", async () => {
    const { DecisionGraph } = await import("./decision-graph.js");

    const graph = new DecisionGraph(new CortexClient({ host: "localhost", port: 19999 }), "test");
    const events = await graph.queryEvents("agent-1");

    expect(events).toEqual([]);
  });

  test("explainAction returns empty chain for unreachable cortex", async () => {
    const { DecisionGraph } = await import("./decision-graph.js");

    const graph = new DecisionGraph(new CortexClient({ host: "localhost", port: 19999 }), "test");
    const chain = await graph.explainAction("event-1");

    expect(chain.chain).toEqual([]);
  });

  test("queryEvents accepts date and type filters", async () => {
    const { DecisionGraph } = await import("./decision-graph.js");

    const graph = new DecisionGraph(new CortexClient({ host: "localhost", port: 19999 }), "test");
    const events = await graph.queryEvents(
      "agent-1",
      new Date("2026-01-01"),
      new Date("2026-12-31"),
      ["tool_call", "error"],
    );

    expect(events).toEqual([]);
  });
});

// ============================================================================
// QueryEngine Tests
// ============================================================================

describe("query engine", () => {
  test("constructs without error", async () => {
    const { ObservabilityQueryEngine } = await import("./query-engine.js");

    const engine = new ObservabilityQueryEngine(
      new CortexClient({ host: "localhost", port: 9999 }),
      "test",
    );
    expect(engine).toBeDefined();
  });

  test("aggregateStats returns zero stats for unreachable cortex", async () => {
    const { ObservabilityQueryEngine } = await import("./query-engine.js");

    const engine = new ObservabilityQueryEngine(
      new CortexClient({ host: "localhost", port: 19999 }),
      "test",
    );
    const stats = await engine.aggregateStats("agent-1");

    expect(stats.agentId).toBe("agent-1");
    expect(stats.totalEvents).toBe(0);
    expect(stats.toolCalls).toBe(0);
    expect(stats.llmCalls).toBe(0);
    expect(stats.decisions).toBe(0);
    expect(stats.delegations).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.avgToolDurationMs).toBe(0);
    expect(stats.avgLLMDurationMs).toBe(0);
  });

  test("findSlowOps returns empty array for unreachable cortex", async () => {
    const { ObservabilityQueryEngine } = await import("./query-engine.js");

    const engine = new ObservabilityQueryEngine(
      new CortexClient({ host: "localhost", port: 19999 }),
      "test",
    );
    const ops = await engine.findSlowOps("agent-1", 1000);

    expect(ops).toEqual([]);
  });

  test("findErrors returns empty array for unreachable cortex", async () => {
    const { ObservabilityQueryEngine } = await import("./query-engine.js");

    const engine = new ObservabilityQueryEngine(
      new CortexClient({ host: "localhost", port: 19999 }),
      "test",
    );
    const errors = await engine.findErrors("agent-1");

    expect(errors).toEqual([]);
  });

  test("aggregateStats accepts time range", async () => {
    const { ObservabilityQueryEngine } = await import("./query-engine.js");

    const engine = new ObservabilityQueryEngine(
      new CortexClient({ host: "localhost", port: 19999 }),
      "test",
    );
    const stats = await engine.aggregateStats("agent-1", {
      from: new Date("2026-01-01"),
      to: new Date("2026-12-31"),
    });

    expect(stats.agentId).toBe("agent-1");
    expect(stats.totalEvents).toBe(0);
  });
});

// ============================================================================
// Formatter Tests
// ============================================================================

describe("formatters", () => {
  test("formatStatsTerminal produces readable output", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const stats = {
      agentId: "agent-1",
      totalEvents: 100,
      toolCalls: 40,
      llmCalls: 30,
      decisions: 15,
      delegations: 10,
      errors: 5,
      avgToolDurationMs: 120,
      avgLLMDurationMs: 850,
    };

    const output = ObservabilityFormatter.formatStatsTerminal(stats);

    expect(output).toContain("Agent: agent-1");
    expect(output).toContain("Total Events: 100");
    expect(output).toContain("Tool Calls:   40");
    expect(output).toContain("avg 120ms");
    expect(output).toContain("LLM Calls:    30");
    expect(output).toContain("avg 850ms");
    expect(output).toContain("Decisions:    15");
    expect(output).toContain("Delegations:  10");
    expect(output).toContain("Errors:       5");
  });

  test("formatEventsTerminal shows events with timestamps", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const events: import("./trace-emitter.js").TraceEvent[] = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "tool_call",
        agentId: "agent-1",
        timestamp: "2026-02-23T10:30:00.000Z",
        durationMs: 42,
        fields: { toolName: "read_file", input: "{}", output: "data" },
      },
      {
        id: "11111111-2222-3333-4444-555555555555",
        type: "error",
        agentId: "agent-1",
        timestamp: "2026-02-23T10:31:00.000Z",
        fields: { error: "Connection failed" },
      },
    ];

    const output = ObservabilityFormatter.formatEventsTerminal(events);

    expect(output).toContain("tool_call");
    expect(output).toContain("read_file");
    expect(output).toContain("42ms");
    expect(output).toContain("aaaaaaaa");
    expect(output).toContain("error");
    expect(output).toContain("Connection failed");
    expect(output).toContain("11111111");
  });

  test("formatEventsTerminal handles empty array", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const output = ObservabilityFormatter.formatEventsTerminal([]);
    expect(output).toBe("No events found.");
  });

  test("formatCausalChainTerminal shows indented chain", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const chain = {
      chain: [
        {
          eventId: "aaaaaaaa-1111-2222-3333-444444444444",
          type: "decision",
          agentId: "agent-1",
          timestamp: "2026-02-23T10:00:00.000Z",
          summary: "Decision: choose strategy -> aggressive",
        },
        {
          eventId: "bbbbbbbb-1111-2222-3333-444444444444",
          type: "tool_call",
          agentId: "agent-1",
          timestamp: "2026-02-23T10:01:00.000Z",
          summary: "Tool call: deploy (150ms)",
        },
      ],
    };

    const output = ObservabilityFormatter.formatCausalChainTerminal(chain);

    expect(output).toContain("Causal Chain:");
    expect(output).toContain("choose strategy");
    expect(output).toContain("-> ");
    expect(output).toContain("deploy");
    expect(output).toContain("aaaaaaaa");
    expect(output).toContain("bbbbbbbb");
  });

  test("formatCausalChainTerminal handles empty chain", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const output = ObservabilityFormatter.formatCausalChainTerminal({ chain: [] });
    expect(output).toBe("No causal chain found.");
  });

  test("formatStatsJSON produces valid JSON", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const stats = {
      agentId: "agent-1",
      totalEvents: 50,
      toolCalls: 20,
      llmCalls: 15,
      decisions: 8,
      delegations: 4,
      errors: 3,
      avgToolDurationMs: 100,
      avgLLMDurationMs: 500,
    };

    const output = ObservabilityFormatter.formatStatsJSON(stats);
    const parsed = JSON.parse(output);

    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.totalEvents).toBe(50);
    expect(parsed.avgToolDurationMs).toBe(100);
  });

  test("formatEventsMarkdown produces a table", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const events = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "llm_call" as const,
        agentId: "agent-1",
        timestamp: "2026-02-23T10:30:00.000Z",
        durationMs: 800,
        fields: { model: "claude-3", totalTokens: "450" },
      },
    ];

    const output = ObservabilityFormatter.formatEventsMarkdown(events);

    expect(output).toContain("| Timestamp |");
    expect(output).toContain("|-----------|");
    expect(output).toContain("llm_call");
    expect(output).toContain("claude-3");
    expect(output).toContain("450tok");
    expect(output).toContain("800ms");
  });

  test("formatEventsMarkdown handles empty array", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const output = ObservabilityFormatter.formatEventsMarkdown([]);
    expect(output).toBe("No events found.");
  });

  test("formatEventsTerminal formats all event types", async () => {
    const { ObservabilityFormatter } = await import("./formatters.js");

    const events: import("./trace-emitter.js").TraceEvent[] = [
      {
        id: "11111111-0000-0000-0000-000000000000",
        type: "llm_call",
        agentId: "a",
        timestamp: "2026-01-01T00:00:00.000Z",
        durationMs: 100,
        fields: { model: "m", totalTokens: "10" },
      },
      {
        id: "22222222-0000-0000-0000-000000000000",
        type: "decision",
        agentId: "a",
        timestamp: "2026-01-01T00:01:00.000Z",
        fields: { description: "pick A or B" },
      },
      {
        id: "33333333-0000-0000-0000-000000000000",
        type: "delegation",
        agentId: "a",
        timestamp: "2026-01-01T00:02:00.000Z",
        fields: { parentId: "p", childId: "c" },
      },
    ];

    const output = ObservabilityFormatter.formatEventsTerminal(events);

    expect(output).toContain("llm_call");
    expect(output).toContain("m 10tok");
    expect(output).toContain("decision");
    expect(output).toContain("pick A or B");
    expect(output).toContain("delegation");
    expect(output).toContain("p -> c");
  });
});
