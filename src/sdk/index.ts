/**
 * Standalone Agent SDK — simplified wrapper around GatewayChatClient.
 *
 * Usage:
 *   import { MayrosClient } from "@apilium/mayros/sdk";
 *
 *   const client = new MayrosClient({ url: "ws://localhost:3000", token: "..." });
 *   await client.connect();
 *   for await (const event of client.sendMessage("Hello")) {
 *     console.log(event);
 *   }
 *   await client.disconnect();
 */

import { randomUUID } from "node:crypto";
import {
  GatewayChatClient,
  resolveGatewayConnection,
  type ChatAttachmentInput,
  type GatewaySessionList,
} from "../tui/gateway-chat.js";
import type { SdkOptions, SdkEvent } from "./types.js";

export { type SdkOptions, type SdkMessage, type SdkEvent } from "./types.js";
export { type ChatAttachmentInput, type GatewaySessionList } from "../tui/gateway-chat.js";

const DEFAULT_TIMEOUT = 120_000;

export class MayrosClient {
  private client: GatewayChatClient | null = null;
  private readonly opts: Required<Pick<SdkOptions, "timeoutMs">> & SdkOptions;
  private connected = false;
  private activeRunId: string | null = null;
  private activeSessionKey: string | null = null;

  constructor(opts?: SdkOptions) {
    this.opts = { timeoutMs: DEFAULT_TIMEOUT, ...opts };
  }

  /** Connect to the gateway. Must be called before sendMessage. */
  async connect(): Promise<void> {
    if (this.connected) return;
    const connection = resolveGatewayConnection({
      url: this.opts.url,
      token: this.opts.token,
    });
    this.client = new GatewayChatClient(connection);
    this.client.start();
    await this.client.waitForReady();
    this.connected = true;
  }

  /** Disconnect from the gateway. */
  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) return;
    this.client.stop();
    this.client = null;
    this.connected = false;
  }

  /**
   * Send a message and receive streaming events.
   * Yields SdkEvent objects as they arrive.
   */
  async *sendMessage(
    prompt: string,
    opts?: { attachments?: ChatAttachmentInput[] },
  ): AsyncGenerator<SdkEvent> {
    if (!this.client || !this.connected) {
      throw new Error("Not connected. Call connect() first.");
    }

    // When a session key is explicitly set, use it. Otherwise, derive a stable
    // session key from the agent ID (if provided) so that messages to the same
    // agent land in the same session across sendMessage calls.
    const sessionKey =
      this.opts.session ?? (this.opts.agent ? `sdk-${this.opts.agent}` : `sdk-${randomUUID()}`);
    const runId = randomUUID();
    this.activeRunId = runId;
    this.activeSessionKey = sessionKey;

    // Collect events via callback
    const events: SdkEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    const waitForEvent = (): Promise<void> =>
      new Promise<void>((r) => {
        if (events.length > 0 || done) {
          r();
        } else {
          resolve = r;
        }
      });

    const pushEvent = (evt: SdkEvent): void => {
      events.push(evt);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    this.client.onEvent = (event) => {
      const { event: eventName, payload } = event;
      const data = payload as Record<string, unknown> | undefined;
      if (eventName === "chat.delta" && data) {
        const text = (data.text as string) ?? "";
        if (text) pushEvent({ type: "text", text });
      } else if (eventName === "chat.tool_use" && data) {
        pushEvent({
          type: "tool_use",
          name: (data.name as string) ?? "",
          args: data.args ?? {},
        });
      } else if (eventName === "chat.tool_result" && data) {
        pushEvent({
          type: "tool_result",
          name: (data.name as string) ?? "",
          result: data.result ?? {},
        });
      } else if (eventName === "chat.thinking" && data) {
        pushEvent({ type: "thinking", text: (data.text as string) ?? "" });
      } else if (eventName === "chat.final" && data) {
        pushEvent({
          type: "done",
          usage: data.usage
            ? {
                inputTokens: (data.usage as Record<string, number>).inputTokens ?? 0,
                outputTokens: (data.usage as Record<string, number>).outputTokens ?? 0,
              }
            : undefined,
        });
        this.activeRunId = null;
        this.activeSessionKey = null;
        done = true;
      } else if (eventName === "chat.error" && data) {
        pushEvent({
          type: "error",
          message: (data.message as string) ?? "Unknown error",
        });
        this.activeRunId = null;
        this.activeSessionKey = null;
        done = true;
      } else if (eventName === "chat.aborted") {
        pushEvent({ type: "error", message: "Aborted" });
        this.activeRunId = null;
        this.activeSessionKey = null;
        done = true;
      }
    };

    this.client.onDisconnected = () => {
      if (!done) {
        error = new Error("Gateway disconnected unexpectedly");
        this.activeRunId = null;
        this.activeSessionKey = null;
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      }
    };

    // Forward model option by patching the session before sending.
    // agentId is not a patchable session field in the protocol — it is
    // encoded in the session key itself (agent option is used when computing
    // the default session key above, so no separate patch is needed).
    if (this.opts.model) {
      try {
        await this.client.patchSession({
          key: sessionKey,
          model: this.opts.model,
        });
      } catch {
        // Best-effort: proceed even if patch fails (e.g., model unknown)
      }
    }

    await this.client.sendChat({
      sessionKey,
      message: prompt,
      thinking: this.opts.thinking,
      runId,
      attachments: opts?.attachments,
      timeoutMs: this.opts.timeoutMs,
    });

    // Yield events as they arrive
    while (!done || events.length > 0) {
      if (events.length === 0) {
        await waitForEvent();
      }
      while (events.length > 0) {
        yield events.shift()!;
      }
      if (error) throw error;
    }
  }

  /**
   * Convenience: send a message and collect all text into a single string.
   */
  async sendMessageFull(prompt: string): Promise<string> {
    const parts: string[] = [];
    for await (const event of this.sendMessage(prompt)) {
      if (event.type === "text") {
        parts.push(event.text);
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return parts.join("");
  }

  /** Abort the current chat without tearing down the connection. */
  async abort(): Promise<void> {
    if (!this.client || !this.connected) return;
    const runId = this.activeRunId;
    const sessionKey = this.activeSessionKey;
    if (!runId || !sessionKey) {
      // No active run — nothing to abort
      return;
    }
    try {
      await this.client.abortChat({ sessionKey, runId });
    } catch {
      // If the abort request fails (e.g. run already finished), disconnect as
      // a last resort to unblock the caller.
      await this.disconnect();
    }
  }

  /** List available sessions. */
  async listSessions(): Promise<GatewaySessionList> {
    if (!this.client || !this.connected) {
      throw new Error("Not connected. Call connect() first.");
    }
    return this.client.listSessions();
  }
}
