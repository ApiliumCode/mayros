import process from "node:process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { GatewayChatClient, resolveGatewayConnection, type GatewayEvent } from "./gateway-chat.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";
import { A11yRenderer } from "./a11y-renderer.js";
import type { TuiOptions } from "./tui-types.js";

export async function runA11yTui(opts: TuiOptions): Promise<void> {
  const renderer = new A11yRenderer();
  renderer.announce("Mayros Accessible Mode");

  const connection = resolveGatewayConnection({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const client = new GatewayChatClient({
    url: connection.url,
    token: connection.token,
    password: connection.password,
  });

  const sessionKey = opts.session ?? "main";
  const assembler = new TuiStreamAssembler();
  const showThinking = opts.thinking === "on" || opts.thinking === "verbose";

  let currentRunId: string | null = null;
  let lastOutputLength = 0;

  client.onEvent = (evt: GatewayEvent) => {
    const payload = evt.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const eventRunId = (payload.runId as string) ?? "";
    if (currentRunId && eventRunId && eventRunId !== currentRunId) return;

    if (evt.event === "chat") {
      const state = (payload.state as string) ?? "";
      const message = payload.message ?? payload;

      if (state === "delta") {
        const displayText = assembler.ingestDelta(
          eventRunId || currentRunId || "",
          message,
          showThinking,
        );
        if (displayText !== null) {
          const incremental = displayText.slice(lastOutputLength);
          if (incremental) {
            process.stdout.write(incremental);
            lastOutputLength = displayText.length;
          }
        }
      } else if (state === "final") {
        const finalText = assembler.finalize(
          eventRunId || currentRunId || "",
          message,
          showThinking,
        );
        const remaining = finalText.slice(lastOutputLength);
        if (remaining) {
          process.stdout.write(remaining);
        }
        if (!finalText.endsWith("\n")) {
          process.stdout.write("\n");
        }
        renderer.emit({ type: "status", text: "Ready" });
        lastOutputLength = 0;
        currentRunId = null;
      } else if (state === "error") {
        const errorText =
          typeof payload.errorMessage === "string" ? payload.errorMessage : JSON.stringify(payload);
        renderer.emit({ type: "system", text: `Error: ${errorText}` });
        lastOutputLength = 0;
        currentRunId = null;
      } else if (state === "aborted") {
        renderer.emit({ type: "system", text: "Response aborted" });
        lastOutputLength = 0;
        currentRunId = null;
      }
    } else if (evt.event === "agent") {
      const stream = (payload.stream as string) ?? "";
      const data = payload.data as Record<string, unknown> | undefined;
      if (stream === "tool.start" && data) {
        const toolName = (data.name as string) ?? "unknown";
        renderer.emit({ type: "tool-start", name: toolName });
      } else if (stream === "tool.result" && data) {
        const toolName = (data.name as string) ?? "unknown";
        const text = (data.text as string) ?? "";
        const isError = Boolean(data.isError);
        renderer.emit({ type: "tool-result", name: toolName, text, isError });
      }
    }
  };

  // Declare the readline interface before wiring client disconnect handling,
  // so a disconnect between client.start() and the readline creation cannot
  // reference `rl` in its temporal dead zone.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  client.onDisconnected = (reason: string) => {
    renderer.emit({ type: "system", text: `Disconnected: ${reason}` });
    rl.close();
  };

  client.start();

  try {
    await client.waitForReady();
    renderer.emit({ type: "status", text: "Connected to gateway" });
  } catch {
    renderer.emit({ type: "system", text: "Could not connect to Gateway" });
    client.stop();
    return;
  }

  // Send auto-message if provided
  if (opts.message?.trim()) {
    const runId = randomUUID();
    currentRunId = runId;
    renderer.emit({ type: "user", text: opts.message.trim() });
    await client.sendChat({
      sessionKey,
      message: opts.message.trim(),
      thinking: opts.thinking,
      deliver: opts.deliver,
      runId,
    });
  }

  rl.prompt();

  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    if (text === "/quit" || text === "/exit") {
      renderer.announce("Goodbye");
      rl.close();
      client.stop();
      return;
    }

    const runId = randomUUID();
    currentRunId = runId;
    lastOutputLength = 0;
    renderer.emit({ type: "user", text });

    client
      .sendChat({
        sessionKey,
        message: text,
        thinking: opts.thinking,
        deliver: opts.deliver,
        runId,
      })
      .catch((err) => {
        renderer.emit({ type: "system", text: `Send failed: ${String(err)}` });
      });
  });

  rl.on("close", () => {
    client.stop();
  });

  // Keep alive until readline closes
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}
