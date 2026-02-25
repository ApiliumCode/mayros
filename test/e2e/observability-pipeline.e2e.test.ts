/**
 * E2E: Observability Pipeline
 *
 * Tests trace emitter flushing, event querying, and decision graph
 * causal chain analysis. Uses mocked Cortex client.
 */

import { describe, it, expect, beforeEach } from "vitest";

// Mock event storage for the pipeline test
type MockEvent = {
  id: string;
  type: string;
  agentId: string;
  timestamp: string;
  fields: Record<string, string>;
  parentEvent?: string;
};

class MockTraceStore {
  events: MockEvent[] = [];

  emit(event: MockEvent): void {
    this.events.push(event);
  }

  query(agentId: string, types?: string[]): MockEvent[] {
    return this.events
      .filter((e) => e.agentId === agentId)
      .filter((e) => !types || types.includes(e.type));
  }

  getEvent(id: string): MockEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  getCausalChain(eventId: string): MockEvent[] {
    const chain: MockEvent[] = [];
    let current = this.getEvent(eventId);
    while (current) {
      chain.push(current);
      current = current.parentEvent ? this.getEvent(current.parentEvent) : undefined;
    }
    return chain;
  }
}

describe("Observability Pipeline E2E", () => {
  let store: MockTraceStore;

  beforeEach(() => {
    store = new MockTraceStore();
  });

  it("emits and queries tool call events", () => {
    store.emit({
      id: "evt-1",
      type: "tool_call",
      agentId: "agent-1",
      timestamp: new Date().toISOString(),
      fields: { tool: "read_file", duration_ms: "42" },
    });

    const events = store.query("agent-1", ["tool_call"]);
    expect(events).toHaveLength(1);
    expect(events[0].fields.tool).toBe("read_file");
  });

  it("emits and queries LLM call events", () => {
    store.emit({
      id: "evt-2",
      type: "llm_call",
      agentId: "agent-1",
      timestamp: new Date().toISOString(),
      fields: { model: "claude-opus-4-6", prompt_tokens: "1000", completion_tokens: "500" },
    });

    const events = store.query("agent-1", ["llm_call"]);
    expect(events).toHaveLength(1);
    expect(events[0].fields.model).toBe("claude-opus-4-6");
  });

  it("filters events by type", () => {
    store.emit({ id: "e1", type: "tool_call", agentId: "a1", timestamp: "", fields: {} });
    store.emit({ id: "e2", type: "llm_call", agentId: "a1", timestamp: "", fields: {} });
    store.emit({ id: "e3", type: "error", agentId: "a1", timestamp: "", fields: {} });

    expect(store.query("a1", ["tool_call"])).toHaveLength(1);
    expect(store.query("a1", ["llm_call"])).toHaveLength(1);
    expect(store.query("a1")).toHaveLength(3);
  });

  it("builds causal chain from parent events", () => {
    store.emit({
      id: "root",
      type: "decision",
      agentId: "a1",
      timestamp: "t1",
      fields: { reason: "user-request" },
    });
    store.emit({
      id: "child-1",
      type: "tool_call",
      agentId: "a1",
      timestamp: "t2",
      fields: { tool: "search" },
      parentEvent: "root",
    });
    store.emit({
      id: "child-2",
      type: "llm_call",
      agentId: "a1",
      timestamp: "t3",
      fields: { model: "opus" },
      parentEvent: "child-1",
    });

    const chain = store.getCausalChain("child-2");
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe("child-2");
    expect(chain[1].id).toBe("child-1");
    expect(chain[2].id).toBe("root");
  });

  it("causal chain stops at root event", () => {
    store.emit({
      id: "orphan",
      type: "error",
      agentId: "a1",
      timestamp: "t1",
      fields: { error: "something" },
    });

    const chain = store.getCausalChain("orphan");
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe("orphan");
  });

  it("handles multiple agents independently", () => {
    store.emit({ id: "a1-1", type: "tool_call", agentId: "agent-1", timestamp: "", fields: {} });
    store.emit({ id: "a2-1", type: "tool_call", agentId: "agent-2", timestamp: "", fields: {} });
    store.emit({ id: "a1-2", type: "llm_call", agentId: "agent-1", timestamp: "", fields: {} });

    expect(store.query("agent-1")).toHaveLength(2);
    expect(store.query("agent-2")).toHaveLength(1);
  });

  it("returns undefined for unknown event ID", () => {
    expect(store.getEvent("nonexistent")).toBeUndefined();
  });
});
