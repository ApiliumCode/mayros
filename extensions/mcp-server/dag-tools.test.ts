import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDagTools } from "./dag-tools.js";

// ── Mock fetch ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(data: unknown, ok = true, text?: string) {
  return vi.fn().mockResolvedValue({
    ok,
    statusText: ok ? "OK" : "Internal Server Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(text ?? JSON.stringify(data)),
  });
}

describe("DAG MCP Tools", () => {
  const deps = { cortexBaseUrl: "http://127.0.0.1:19090", namespace: "test" };
  let tools: ReturnType<typeof createDagTools>;

  beforeEach(() => {
    tools = createDagTools(deps);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
  }

  // 1
  it("mayros_dag_tips happy path", async () => {
    globalThis.fetch = mockFetch({ tips: ["aaa", "bbb"], count: 2 });
    const tool = findTool("mayros_dag_tips");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("2 tip(s)");
    expect(result.content[0]!.text).toContain("aaa");
  });

  // 2
  it("mayros_dag_tips Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_tips");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 3
  it("mayros_dag_history happy path", async () => {
    globalThis.fetch = mockFetch({
      actions: [
        {
          hash: "abc123def456",
          seq: 1,
          timestamp: "2026-03-13T10:00:00Z",
          payload_type: "CreateTriple",
          payload_summary: "added fact",
        },
      ],
    });
    const tool = findTool("mayros_dag_history");
    const result = await tool.execute("id", { subject: "project:api", limit: 10 });
    expect(result.content[0]!.text).toContain("1 action(s)");
    expect(result.content[0]!.text).toContain("added fact");
  });

  // 4
  it("mayros_dag_stats happy path", async () => {
    globalThis.fetch = mockFetch({ action_count: 42, tip_count: 3 });
    const tool = findTool("mayros_dag_stats");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("Actions: 42");
    expect(result.content[0]!.text).toContain("Tips: 3");
  });

  // 5
  it("mayros_dag_export mermaid output", async () => {
    const mermaid = "graph TD\n  A-->B";
    globalThis.fetch = mockFetch(null, true, mermaid);
    const tool = findTool("mayros_dag_export");
    const result = await tool.execute("id", { format: "mermaid" });
    expect(result.content[0]!.text).toContain("graph TD");
  });

  // 6
  it("mayros_dag_diff happy path", async () => {
    globalThis.fetch = mockFetch({
      from: "aaa111",
      to: "bbb222",
      action_count: 2,
      actions: [
        { hash: "ccc333def456", payload_type: "CreateTriple", payload_summary: "add X" },
        { hash: "ddd444def456", payload_type: "DeleteTriple", payload_summary: "remove Y" },
      ],
    });
    const tool = findTool("mayros_dag_diff");
    const result = await tool.execute("id", { from: "aaa111", to: "bbb222" });
    expect(result.content[0]!.text).toContain("2 action(s)");
    expect(result.content[0]!.text).toContain("add X");
  });

  // 7
  it("mayros_dag_time_travel happy path", async () => {
    globalThis.fetch = mockFetch({
      target_hash: "abc123",
      target_timestamp: "2026-03-10T10:00:00Z",
      actions_replayed: 15,
      triple_count: 100,
    });
    const tool = findTool("mayros_dag_time_travel");
    const result = await tool.execute("id", { hash: "abc123" });
    expect(result.content[0]!.text).toContain("Actions replayed: 15");
    expect(result.content[0]!.text).toContain("Triples at that point: 100");
  });

  // 8
  it("mayros_dag_verify valid signature (POST body)", async () => {
    globalThis.fetch = mockFetch({
      valid: true,
      action_hash: "abc123",
      public_key: "ed25519_key",
      detail: "Signature valid",
    });
    const tool = findTool("mayros_dag_verify");
    const result = await tool.execute("id", { hash: "abc123", public_key: "ed25519_key" });
    expect(result.content[0]!.text).toContain("VALID");
    expect(result.content[0]!.text).toContain("Signature valid");

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = callArgs[0] as string;
    const opts = callArgs[1] as RequestInit;
    expect(url).not.toContain("public_key");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ public_key: "ed25519_key" });
  });

  // 9
  it("mayros_dag_prune happy path with confirm", async () => {
    globalThis.fetch = mockFetch({
      pruned_count: 10,
      retained_count: 32,
      checkpoint_hash: "chk_abc",
    });
    const tool = findTool("mayros_dag_prune");
    const result = await tool.execute("id", {
      policy: "keep_last",
      value: 32,
      create_checkpoint: true,
      confirm: true,
    });
    expect(result.content[0]!.text).toContain("Pruned: 10");
    expect(result.content[0]!.text).toContain("Retained: 32");
    expect(result.content[0]!.text).toContain("chk_abc");
  });

  // 10
  it("mayros_dag_prune rejects without confirm", async () => {
    const tool = findTool("mayros_dag_prune");
    const result = await tool.execute("id", {
      policy: "keep_last",
      value: 32,
    });
    expect(result.content[0]!.text).toContain("aborted");
    expect(result.content[0]!.text).toContain("confirm must be true");
  });

  // 11
  it("mayros_dag_history Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_history");
    const result = await tool.execute("id", { subject: "test" });
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 12
  it("mayros_dag_stats Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_stats");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 13
  it("mayros_dag_tips HTTP error", async () => {
    globalThis.fetch = mockFetch(null, false);
    const tool = findTool("mayros_dag_tips");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("failed");
  });

  // 14
  it("mayros_dag_verify Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_verify");
    const result = await tool.execute("id", { hash: "abc", public_key: "key" });
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 15
  it("mayros_dag_diff HTTP error", async () => {
    globalThis.fetch = mockFetch(null, false);
    const tool = findTool("mayros_dag_diff");
    const result = await tool.execute("id", { from: "a", to: "b" });
    expect(result.content[0]!.text).toContain("failed");
  });

  // 16
  it("mayros_dag_history empty results", async () => {
    globalThis.fetch = mockFetch({ actions: [] });
    const tool = findTool("mayros_dag_history");
    const result = await tool.execute("id", { subject: "test:none" });
    expect(result.content[0]!.text).toContain("No DAG history");
  });

  // 17
  it("mayros_dag_history caps limit at 500", async () => {
    globalThis.fetch = mockFetch({ actions: [] });
    const tool = findTool("mayros_dag_history");
    await tool.execute("id", { subject: "test", limit: 99999 });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("limit=500");
  });

  // 18
  it("mayros_dag_export truncates large output", async () => {
    const hugeOutput = "x".repeat(300 * 1024); // 300 KB
    globalThis.fetch = mockFetch(null, true, hugeOutput);
    const tool = findTool("mayros_dag_export");
    const result = await tool.execute("id", { format: "mermaid" });
    expect(result.content[0]!.text).toContain("TRUNCATED");
    expect(result.content[0]!.text!.length).toBeLessThan(300 * 1024);
  });

  // 20
  it("mayros_dag_export Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_export");
    const result = await tool.execute("id", {});
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 21
  it("mayros_dag_prune Cortex down with confirm", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_prune");
    const result = await tool.execute("id", { policy: "keep_all", confirm: true });
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 22
  it("mayros_dag_action happy path", async () => {
    globalThis.fetch = mockFetch({
      hash: "abc123def456789000000000",
      parents: ["parent1aaa", "parent2bbb"],
      author: "node-1",
      seq: 5,
      timestamp: "2026-03-13T12:00:00Z",
      payload_type: "TripleInsert",
      payload_summary: "added 3 triples",
      signed: true,
      signature: "ed25519sig0123456789abcdef",
    });
    const tool = findTool("mayros_dag_action");
    const result = await tool.execute("id", { hash: "abc123def456789000000000" });
    expect(result.content[0]!.text).toContain("Action abc123def456…");
    expect(result.content[0]!.text).toContain("Author: node-1");
    expect(result.content[0]!.text).toContain("Seq: 5");
    expect(result.content[0]!.text).toContain("TripleInsert");
    expect(result.content[0]!.text).toContain("Signed: true");
  });

  // 23
  it("mayros_dag_action genesis (no parents)", async () => {
    globalThis.fetch = mockFetch({
      hash: "genesis000000000000000000",
      parents: [],
      author: "node-1",
      seq: 0,
      timestamp: "2026-03-01T00:00:00Z",
      payload_type: "Genesis",
      payload_summary: "initial state",
      signed: false,
      signature: null,
    });
    const tool = findTool("mayros_dag_action");
    const result = await tool.execute("id", { hash: "genesis000000000000000000" });
    expect(result.content[0]!.text).toContain("(genesis)");
    expect(result.content[0]!.text).toContain("Signed: false");
  });

  // 24
  it("mayros_dag_action Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_action");
    const result = await tool.execute("id", { hash: "abc" });
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 25
  it("mayros_dag_action HTTP error", async () => {
    globalThis.fetch = mockFetch(null, false);
    const tool = findTool("mayros_dag_action");
    const result = await tool.execute("id", { hash: "abc" });
    expect(result.content[0]!.text).toContain("failed");
  });

  // 26
  it("mayros_dag_chain happy path", async () => {
    globalThis.fetch = mockFetch({
      actions: [
        {
          hash: "aaa111def456",
          seq: 1,
          timestamp: "2026-03-13T10:00:00Z",
          payload_type: "TripleInsert",
          payload_summary: "added fact",
        },
        {
          hash: "bbb222def456",
          seq: 2,
          timestamp: "2026-03-13T11:00:00Z",
          payload_type: "TripleDelete",
          payload_summary: "removed old",
        },
      ],
    });
    const tool = findTool("mayros_dag_chain");
    const result = await tool.execute("id", { author: "node-1", limit: 10 });
    expect(result.content[0]!.text).toContain('2 action(s) by "node-1"');
    expect(result.content[0]!.text).toContain("added fact");
    expect(result.content[0]!.text).toContain("removed old");
  });

  // 27
  it("mayros_dag_chain empty results", async () => {
    globalThis.fetch = mockFetch({ actions: [] });
    const tool = findTool("mayros_dag_chain");
    const result = await tool.execute("id", { author: "unknown-node" });
    expect(result.content[0]!.text).toContain("No DAG actions");
  });

  // 28
  it("mayros_dag_chain Cortex down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const tool = findTool("mayros_dag_chain");
    const result = await tool.execute("id", { author: "node-1" });
    expect(result.content[0]!.text).toContain("Cortex unavailable");
  });

  // 29
  it("mayros_dag_chain caps limit at 500", async () => {
    globalThis.fetch = mockFetch({ actions: [] });
    const tool = findTool("mayros_dag_chain");
    await tool.execute("id", { author: "node-1", limit: 99999 });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("limit=500");
  });
});
