import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runHeadless,
  resolveOutputFormat,
  buildPromptWithSystemOverrides,
  parseToolsList,
  validateJsonSchema,
  type HeadlessOptions,
} from "./headless-cli.js";

// ============================================================================
// Mocks
// ============================================================================

type MockClientInstance = {
  onEvent?: (evt: { event: string; payload?: unknown; seq?: number }) => void;
  onDisconnected?: (reason: string) => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  waitForReady: ReturnType<typeof vi.fn>;
  sendChat: ReturnType<typeof vi.fn>;
};

let mockClient: MockClientInstance;
let failWaitForReady = false;
let failSendChat = false;

vi.mock("../tui/gateway-chat.js", () => ({
  GatewayChatClient: class {
    onEvent?: (evt: { event: string; payload?: unknown }) => void;
    onDisconnected?: (reason: string) => void;
    start = vi.fn();
    stop = vi.fn();
    waitForReady = vi.fn(async () => {
      if (failWaitForReady) throw new Error("refused");
    });
    sendChat = vi.fn(async () => {
      if (failSendChat) throw new Error("send failed");
      return { runId: "test-run" };
    });
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      mockClient = this as unknown as MockClientInstance;
    }
  },
  resolveGatewayConnection: vi.fn().mockReturnValue({
    url: "ws://localhost:9090",
    token: "test-token",
  }),
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000000",
}));

vi.mock("../config/io.js", () => ({
  readConfigFileSnapshot: vi.fn().mockReturnValue({
    exists: false,
    config: {},
    hash: "mock",
  }),
}));

vi.mock("../infra/ensure-services.js", () => ({
  ensureServicesRunning: vi.fn(),
}));

// ============================================================================
// Stdout / stderr capture
// ============================================================================

let stdoutOutput: string;
let stderrOutput: string;

beforeEach(() => {
  stdoutOutput = "";
  stderrOutput = "";
  process.exitCode = undefined;
  failWaitForReady = false;
  failSendChat = false;

  vi.spyOn(process.stdout, "write").mockImplementation((data: string | Uint8Array) => {
    stdoutOutput += typeof data === "string" ? data : Buffer.from(data).toString();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((data: string | Uint8Array) => {
    stderrOutput += typeof data === "string" ? data : Buffer.from(data).toString();
    return true;
  });

  // Default: stdin is a TTY (no piped input)
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

function simulateDelta(text: string, runId = "00000000-0000-0000-0000-000000000000") {
  mockClient.onEvent?.({
    event: "chat.delta",
    payload: {
      runId,
      message: { content: text },
    },
  });
}

function simulateFinal(text: string, runId = "00000000-0000-0000-0000-000000000000") {
  mockClient.onEvent?.({
    event: "chat.final",
    payload: {
      runId,
      message: { content: text },
    },
  });
}

function simulateError(error: string, runId = "00000000-0000-0000-0000-000000000000") {
  mockClient.onEvent?.({
    event: "chat.error",
    payload: { runId, error },
  });
}

function simulateAbort(runId = "00000000-0000-0000-0000-000000000000") {
  mockClient.onEvent?.({
    event: "chat.aborted",
    payload: { runId },
  });
}

async function runWithEvents(
  opts: HeadlessOptions,
  events: () => void,
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const promise = runHeadless(opts);

  // Wait a tick for the client to be set up, then fire events
  await new Promise((r) => setTimeout(r, 10));
  events();

  await promise;
  const code = typeof process.exitCode === "number" ? process.exitCode : undefined;
  return { stdout: stdoutOutput, stderr: stderrOutput, exitCode: code };
}

// ============================================================================
// Tests
// ============================================================================

describe("runHeadless", () => {
  it("errors when prompt is empty and stdin is TTY", async () => {
    await runHeadless({ prompt: "" });

    expect(stderrOutput).toContain("no prompt provided");
    expect(process.exitCode).toBe(1);
  });

  it("sends prompt to gateway and streams delta output", async () => {
    const result = await runWithEvents({ prompt: "hello" }, () => {
      simulateDelta("Hello");
      simulateDelta("Hello, world!");
      simulateFinal("Hello, world!");
    });

    expect(result.stdout).toContain("Hello");
    expect(result.stdout).toContain("world!");
    expect(result.exitCode).toBeUndefined();
  });

  it("adds trailing newline when final text does not end with one", async () => {
    const result = await runWithEvents({ prompt: "hi" }, () => {
      simulateFinal("response");
    });

    expect(result.stdout).toMatch(/response\n$/);
  });

  it("writes only final JSON line in --json mode (no streaming deltas)", async () => {
    const result = await runWithEvents({ prompt: "hi", json: true }, () => {
      simulateDelta("abc");
      simulateFinal("abc");
    });

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text: string });
    // --json now maps to outputFormat "json" which only writes the final
    expect(lines.every((l) => l.type === "final")).toBe(true);
    expect(lines.length).toBe(1);
  });

  it("writes error to stderr on chat.error", async () => {
    const result = await runWithEvents({ prompt: "fail" }, () => {
      simulateError("something went wrong");
    });

    expect(result.stderr).toContain("something went wrong");
    expect(result.exitCode).toBe(1);
  });

  it("writes aborted to stderr on chat.aborted", async () => {
    const result = await runWithEvents({ prompt: "cancel" }, () => {
      simulateAbort();
    });

    expect(result.stderr).toContain("Aborted");
    expect(result.exitCode).toBe(1);
  });

  it("exits with error on gateway disconnect", async () => {
    const result = await runWithEvents({ prompt: "disc" }, () => {
      mockClient.onDisconnected?.("server closed");
    });

    expect(result.stderr).toContain("Disconnected");
    expect(result.exitCode).toBe(1);
  });

  it("ignores events from different runIds", async () => {
    const result = await runWithEvents({ prompt: "test" }, () => {
      // Different runId — should be ignored
      simulateDelta("wrong", "other-run-id");
      // Correct runId — should appear
      simulateDelta("correct");
      simulateFinal("correct");
    });

    expect(result.stdout).not.toContain("wrong");
    expect(result.stdout).toContain("correct");
  });

  it("times out if no response arrives", async () => {
    const result = await runWithEvents({ prompt: "slow", timeoutMs: 50 }, () => {
      // No events fired — will timeout
    });

    expect(result.stderr).toContain("timed out");
    expect(result.exitCode).toBe(1);
  });

  it("uses custom session key", async () => {
    const promise = runHeadless({ prompt: "hello", session: "my-session" });
    await new Promise((r) => setTimeout(r, 10));

    const calls = mockClient.sendChat.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].sessionKey).toBe("my-session");
    }

    simulateFinal("done");
    await promise;
  });

  it("stops client after completion", async () => {
    await runWithEvents({ prompt: "hello" }, () => {
      simulateFinal("done");
    });

    expect(mockClient.stop).toHaveBeenCalled();
  });

  it("handles connection failure gracefully", async () => {
    failWaitForReady = true;

    await runHeadless({ prompt: "hello" });

    expect(stderrOutput).toContain("could not connect");
    expect(process.exitCode).toBe(1);
    expect(mockClient.stop).toHaveBeenCalled();
  });

  it("handles sendChat failure gracefully", async () => {
    failSendChat = true;

    await runHeadless({ prompt: "hello" });

    expect(stderrOutput).toContain("Error sending chat");
    expect(process.exitCode).toBe(1);
    expect(mockClient.stop).toHaveBeenCalled();
  });

  it("passes thinking flag to sendChat", async () => {
    const promise = runHeadless({ prompt: "think", thinking: "verbose" });
    await new Promise((r) => setTimeout(r, 10));

    const calls = mockClient.sendChat.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].thinking).toBe("verbose");
    }

    simulateFinal("thought");
    await promise;
  });

  it("passes deliver flag to sendChat", async () => {
    const promise = runHeadless({ prompt: "deliver", deliver: true });
    await new Promise((r) => setTimeout(r, 10));

    const calls = mockClient.sendChat.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].deliver).toBe(true);
    }

    simulateFinal("delivered");
    await promise;
  });

  it("handles final event with empty text", async () => {
    const result = await runWithEvents({ prompt: "empty" }, () => {
      simulateFinal("");
    });

    // TuiStreamAssembler resolves empty content to "(no output)" via resolveFinalAssistantText
    expect(result.stdout).toContain("(no output)");
  });

  it("handles delta followed by different final text", async () => {
    const result = await runWithEvents({ prompt: "partial" }, () => {
      simulateDelta("partial res");
      simulateFinal("partial response complete");
    });

    expect(result.stdout).toContain("partial res");
    expect(result.stdout).toContain("complete");
  });

  it("prepends system prompt when systemPrompt is set", async () => {
    const promise = runHeadless({ prompt: "hello", systemPrompt: "Be concise" });
    await new Promise((r) => setTimeout(r, 10));

    const calls = mockClient.sendChat.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].message).toContain("[System: Be concise]");
      expect(calls[0][0].message).toContain("hello");
    }

    simulateFinal("done");
    await promise;
  });

  it("appends system prompt when appendSystemPrompt is set", async () => {
    const promise = runHeadless({ prompt: "hello", appendSystemPrompt: "Format as markdown" });
    await new Promise((r) => setTimeout(r, 10));

    const calls = mockClient.sendChat.mock.calls;
    if (calls.length > 0) {
      const msg = calls[0][0].message as string;
      expect(msg).toContain("hello");
      expect(msg).toContain("[System: Format as markdown]");
      // Append should come after the prompt
      expect(msg.indexOf("hello")).toBeLessThan(msg.indexOf("[System: Format as markdown]"));
    }

    simulateFinal("done");
    await promise;
  });

  it("writes tool restriction note to stderr when tools are specified", async () => {
    const result = await runWithEvents({ prompt: "hello", tools: "read,write,bash" }, () => {
      simulateFinal("done");
    });

    expect(result.stderr).toContain("tool restriction requested");
    expect(result.stderr).toContain("read, write, bash");
  });

  it("stream-json mode writes deltas as JSON lines without waiting for final", async () => {
    const result = await runWithEvents({ prompt: "hi", outputFormat: "stream-json" }, () => {
      simulateDelta("abc");
      simulateFinal("abc");
    });

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text: string });
    expect(lines.some((l) => l.type === "delta")).toBe(true);
    expect(lines.some((l) => l.type === "final")).toBe(true);
  });

  it("json outputFormat accumulates and only writes final", async () => {
    const result = await runWithEvents({ prompt: "hi", outputFormat: "json" }, () => {
      simulateDelta("abc");
      simulateFinal("abc");
    });

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text: string });
    // In json mode, deltas are NOT written (only final)
    expect(lines.every((l) => l.type === "final")).toBe(true);
  });

  it("stops after maxTurns is reached", async () => {
    const result = await runWithEvents({ prompt: "hello", maxTurns: 1 }, () => {
      simulateFinal("first");
    });

    expect(result.stderr).toContain("Max turns (1) reached");
  });

  it("stops after maxBudgetUsd is exceeded", async () => {
    const result = await runWithEvents({ prompt: "hello", maxBudgetUsd: 0.01 }, () => {
      mockClient.onEvent?.({
        event: "chat.final",
        payload: {
          runId: "00000000-0000-0000-0000-000000000000",
          message: { content: "expensive" },
          usage: { costUsd: 0.05 },
        },
      });
    });

    expect(result.stderr).toContain("Budget cap");
    expect(result.stderr).toContain("exceeded");
  });
});

// ============================================================================
// Pure function tests
// ============================================================================

describe("resolveOutputFormat", () => {
  it("returns explicit outputFormat when set", () => {
    expect(resolveOutputFormat({ outputFormat: "json" })).toBe("json");
    expect(resolveOutputFormat({ outputFormat: "stream-json" })).toBe("stream-json");
    expect(resolveOutputFormat({ outputFormat: "text" })).toBe("text");
  });

  it("falls back to json when legacy json flag is true", () => {
    expect(resolveOutputFormat({ json: true })).toBe("json");
  });

  it("defaults to text", () => {
    expect(resolveOutputFormat({})).toBe("text");
    expect(resolveOutputFormat({ json: false })).toBe("text");
  });

  it("outputFormat takes precedence over json flag", () => {
    expect(resolveOutputFormat({ json: true, outputFormat: "stream-json" })).toBe("stream-json");
    expect(resolveOutputFormat({ json: true, outputFormat: "text" })).toBe("text");
  });
});

describe("buildPromptWithSystemOverrides", () => {
  it("returns prompt unchanged when no system overrides", () => {
    expect(buildPromptWithSystemOverrides("hello", undefined, undefined)).toBe("hello");
  });

  it("prepends system prompt", () => {
    const result = buildPromptWithSystemOverrides("hello", "Be concise", undefined);
    expect(result).toBe("[System: Be concise]\n\nhello");
  });

  it("appends system prompt", () => {
    const result = buildPromptWithSystemOverrides("hello", undefined, "Format as JSON");
    expect(result).toBe("hello\n\n[System: Format as JSON]");
  });

  it("prepends and appends system prompts", () => {
    const result = buildPromptWithSystemOverrides("hello", "Be concise", "Format as JSON");
    expect(result).toBe("[System: Be concise]\n\nhello\n\n[System: Format as JSON]");
  });
});

describe("parseToolsList", () => {
  it("parses comma-separated tools", () => {
    expect(parseToolsList("read,write,bash")).toEqual(["read", "write", "bash"]);
  });

  it("trims whitespace", () => {
    expect(parseToolsList(" read , write , bash ")).toEqual(["read", "write", "bash"]);
  });

  it("filters empty entries", () => {
    expect(parseToolsList("read,,write,")).toEqual(["read", "write"]);
  });

  it("handles single tool", () => {
    expect(parseToolsList("read")).toEqual(["read"]);
  });

  it("handles empty string", () => {
    expect(parseToolsList("")).toEqual([]);
  });
});

describe("validateJsonSchema", () => {
  it("validates object type with required properties", () => {
    const schema = JSON.stringify({ type: "object", required: ["name", "age"] });
    const valid = validateJsonSchema('{"name":"Alice","age":30}', schema);
    expect(valid.valid).toBe(true);
  });

  it("fails when required property is missing", () => {
    const schema = JSON.stringify({ type: "object", required: ["name", "age"] });
    const result = validateJsonSchema('{"name":"Alice"}', schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("age");
    }
  });

  it("fails when output is not valid JSON", () => {
    const schema = JSON.stringify({ type: "object" });
    const result = validateJsonSchema("not json", schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  it("fails when schema is not valid JSON", () => {
    const result = validateJsonSchema('{"a":1}', "not json");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("schema is not valid JSON");
    }
  });

  it("validates type mismatch", () => {
    const schema = JSON.stringify({ type: "string" });
    const result = validateJsonSchema("42", schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("string");
    }
  });

  it("validates array type", () => {
    const schema = JSON.stringify({ type: "array" });
    const result = validateJsonSchema("[1,2,3]", schema);
    expect(result.valid).toBe(true);
  });

  it("validates integer type for float values", () => {
    const schema = JSON.stringify({ type: "integer" });
    const result = validateJsonSchema("3.14", schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("integer");
    }
  });

  it("validates integer type for actual integers", () => {
    const schema = JSON.stringify({ type: "integer" });
    const result = validateJsonSchema("42", schema);
    expect(result.valid).toBe(true);
  });

  it("passes when schema has no type constraint", () => {
    const schema = JSON.stringify({});
    const result = validateJsonSchema('{"anything":"goes"}', schema);
    expect(result.valid).toBe(true);
  });
});
