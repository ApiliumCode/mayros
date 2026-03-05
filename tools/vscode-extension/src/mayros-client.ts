import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  SessionInfo,
  AgentInfo,
  SkillInfo,
  ChatAttachment,
  ChatMessage,
  PlanInfo,
  TraceEvent,
  KgEntry,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type EventHandler = (...args: unknown[]) => void;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ClientOptions = {
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  requestTimeoutMs?: number;
  token?: string;
};

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

/** Minimal WebSocket interface so we can inject mocks in tests. */
export interface IWebSocket {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => IWebSocket;

/* ------------------------------------------------------------------ */
/*  Default factory — uses `ws` package for Node                      */
/* ------------------------------------------------------------------ */

let _defaultFactory: WebSocketFactory | undefined;

async function loadDefaultFactory(): Promise<WebSocketFactory> {
  if (_defaultFactory) return _defaultFactory;
  const mod = await import("ws");
  const WS = mod.default ?? mod;
  _defaultFactory = (url: string) => new WS(url) as unknown as IWebSocket;
  return _defaultFactory;
}

/* ------------------------------------------------------------------ */
/*  Device identity helpers                                            */
/* ------------------------------------------------------------------ */

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function loadDeviceIdentity(): DeviceIdentity | null {
  try {
    const identityPath = path.join(os.homedir(), ".mayros", "identity", "device.json");
    if (!fs.existsSync(identityPath)) return null;
    const raw = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    if (raw?.version === 1 && raw.deviceId && raw.publicKeyPem && raw.privateKeyPem) {
      return {
        deviceId: raw.deviceId,
        publicKeyPem: raw.publicKeyPem,
        privateKeyPem: raw.privateKeyPem,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
}): string {
  const version = params.nonce ? "v2" : "v1";
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
  ];
  if (version === "v2") {
    base.push(params.nonce ?? "");
  }
  return base.join("|");
}

/* ------------------------------------------------------------------ */
/*  MayrosClient                                                       */
/* ------------------------------------------------------------------ */

export class MayrosClient {
  private ws: IWebSocket | null = null;
  private requestId = 0;
  private pending: Map<string, PendingRequest> = new Map();
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _disposed = false;
  private wsFactory: WebSocketFactory | undefined;
  private deviceIdentity: DeviceIdentity | null = null;
  private readonly requestTimeoutMs: number;

  constructor(
    private url: string,
    private options: ClientOptions,
    wsFactory?: WebSocketFactory,
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.wsFactory = wsFactory;
    this.deviceIdentity = loadDeviceIdentity();
  }

  /* ---- state ---- */

  get connected(): boolean {
    return this._connected;
  }

  /* ---- lifecycle ---- */

  async connect(): Promise<void> {
    if (this._disposed) throw new Error("Client is disposed");
    if (this._connected) return;

    const factory = this.wsFactory ?? (await loadDefaultFactory());
    return new Promise<void>((resolve, reject) => {
      try {
        const ws = factory(this.url);
        this.ws = ws;

        ws.onopen = () => {
          // Send gateway handshake (connect request with auth)
          this.sendHandshake(ws)
            .then(() => {
              this._connected = true;
              this.reconnectAttempts = 0;
              this.emit("connected");
              resolve();
            })
            .catch((err) => {
              ws.close(1000, "Handshake failed");
              reject(err);
            });
        };

        ws.onclose = (ev) => {
          const wasConnected = this._connected;
          this._connected = false;
          this.ws = null;
          this.rejectAllPending("Connection closed");
          if (wasConnected) {
            this.emit("disconnected", ev.reason || "Connection closed");
            this.scheduleReconnect();
          }
        };

        ws.onmessage = (ev) => {
          this.handleMessage(String(ev.data));
        };

        ws.onerror = (ev) => {
          const err = ev instanceof Error ? ev : new Error("WebSocket error");
          this.emit("error", err);
          if (!this._connected) {
            reject(err);
          }
        };
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private sendHandshake(ws: IWebSocket): Promise<void> {
    const PROTOCOL_VERSION = 3;
    const id = `handshake-${Date.now()}`;
    const clientId = "gateway-client";
    const clientMode = "ui";
    const role = "operator";
    const scopes = ["operator.read", "operator.write"];
    const gatewayToken = this.options.token;
    const device = this.deviceIdentity;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Gateway handshake timed out"));
      }, 10_000);

      const originalOnMessage = ws.onmessage;

      const sendConnectRequest = (nonce?: string) => {
        const signedAtMs = Date.now();
        const params: Record<string, unknown> = {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: { id: clientId, version: "0.1.0", platform: "vscode", mode: clientMode },
          caps: [],
          commands: [],
          role,
          scopes,
        };
        if (gatewayToken) {
          params.auth = { token: gatewayToken };
        }
        // Include device identity for scope authorization
        if (device) {
          const payload = buildDeviceAuthPayload({
            deviceId: device.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: gatewayToken ?? null,
            nonce,
          });
          const signature = signDevicePayload(device.privateKeyPem, payload);
          params.device = {
            id: device.deviceId,
            publicKey: base64UrlEncode(derivePublicKeyRaw(device.publicKeyPem)),
            signature,
            signedAt: signedAtMs,
            ...(nonce ? { nonce } : {}),
          };
        }
        ws.send(JSON.stringify({ type: "req", id, method: "connect", params }));
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        // Handle connect.challenge — send connect request with nonce
        if (msg.type === "event" && msg.event === "connect.challenge") {
          const payload = msg.payload as Record<string, unknown> | undefined;
          const nonce = typeof payload?.nonce === "string" ? payload.nonce : undefined;
          sendConnectRequest(nonce);
          return;
        }

        // Handle connect response
        if (msg.type === "res" && msg.id === id) {
          clearTimeout(timeout);
          ws.onmessage = originalOnMessage;
          if (msg.ok) {
            // Store device token if provided
            const helloPayload = msg.payload as Record<string, unknown> | undefined;
            if (helloPayload) {
              this.storeDeviceToken(helloPayload);
            }
            resolve();
          } else {
            const err = msg.error as { message?: string } | undefined;
            reject(new Error(err?.message ?? "Gateway handshake rejected"));
          }
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this._connected = false;
      this.rejectAllPending("Disconnected by client");
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onopen = null;
      ws.close(1000, "Client disconnect");
      this.emit("disconnected", "Client disconnect");
    }
  }

  dispose(): void {
    this._disposed = true;
    this.disconnect().catch(() => {});
  }

  /* ---- RPC ---- */

  private nextId(): string {
    return String(++this.requestId);
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this._connected || !this.ws) {
      throw new Error("Not connected to gateway");
    }
    const id = this.nextId();
    // Gateway protocol: { type: "req", id, method, params }
    const request = { type: "req", id, method, params: params ?? {} };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify(request));
    });
  }

  private handleMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // ignore malformed messages
    }

    // Server-push event (type: "event"/"evt" or legacy "event" field)
    if (parsed.type === "event" || parsed.type === "evt" || typeof parsed.event === "string") {
      const eventName = (parsed.method ?? parsed.event) as string;
      const eventData = parsed.payload ?? parsed.params ?? parsed.data;
      if (eventName) {
        this.emit("event", { event: eventName, data: eventData });
        this.emit(`event:${eventName}`, eventData);
      }
      return;
    }

    // RPC response (type: "res")
    const id = parsed.id as string | undefined;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);

    if (parsed.ok === false || parsed.error) {
      const err = parsed.error as { code?: number; message?: string } | undefined;
      pending.reject(
        new Error(`Gateway error ${err?.code ?? "?"}: ${err?.message ?? "Unknown error"}`),
      );
    } else {
      // Gateway wraps result in `payload` field
      pending.resolve((parsed.payload ?? parsed.result) as T);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  /* ---- event emitter ---- */

  on(event: string, handler: EventHandler): void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.eventHandlers.delete(event);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(...args);
        } catch {
          // swallow handler errors
        }
      }
    }
  }

  /* ---- reconnection ---- */

  private scheduleReconnect(): void {
    if (this._disposed) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit(
        "error",
        new Error(`Reconnection failed after ${this.options.maxReconnectAttempts} attempts`),
      );
      return;
    }
    const delay = this.options.reconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // connect failure will trigger onclose -> scheduleReconnect
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  /* ---- helpers ---- */

  /**
   * Store the device token returned by the gateway hello-ok response
   * so subsequent reconnections use it.
   */
  private storeDeviceToken(payload: Record<string, unknown>): void {
    try {
      const auth = payload?.auth as Record<string, unknown> | undefined;
      if (auth?.deviceToken && typeof auth.deviceToken === "string") {
        const fs = require("node:fs");
        const path = require("node:path");
        const os = require("node:os");
        const tokenPath = path.join(os.homedir(), ".mayros", "identity", "device-token.json");
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(
          tokenPath,
          JSON.stringify(
            {
              token: auth.deviceToken,
              role: auth.role,
              scopes: auth.scopes,
              issuedAtMs: auth.issuedAtMs,
            },
            null,
            2,
          ),
        );
      }
    } catch {
      // Non-critical — ignore
    }
  }

  /* ---- domain methods ---- */

  async listSessions(): Promise<SessionInfo[]> {
    const raw = await this.call<Record<string, unknown>>("sessions.list");
    const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
    return sessions.map((s: Record<string, unknown>) => ({
      id: String(s.key ?? ""),
      status: mapSessionStatus(s.kind),
      agentId: String(s.displayName ?? s.label ?? s.key ?? "unknown"),
      startedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : "",
      messageCount: typeof s.totalTokens === "number" ? s.totalTokens : 0,
    }));
  }

  async sendMessage(
    sessionKey: string,
    message: string,
    attachments?: ChatAttachment[],
  ): Promise<void> {
    const params: Record<string, unknown> = {
      sessionKey,
      message,
      idempotencyKey: `vsc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    if (attachments && attachments.length > 0) {
      params.attachments = attachments.map((a) => ({
        type: "image",
        mimeType: a.mimeType,
        fileName: a.name,
        content: a.dataBase64,
      }));
    }
    await this.call<void>("chat.send", params);
  }

  async getChatHistory(sessionKey: string): Promise<ChatMessage[]> {
    const raw = await this.call<Record<string, unknown>>("chat.history", { sessionKey });
    const messages = Array.isArray(raw?.messages) ? raw.messages : [];
    return messages.map((m: Record<string, unknown>) => normalizeMessage(m));
  }

  async abortChat(sessionKey: string): Promise<void> {
    await this.call<void>("chat.abort", { sessionKey });
  }

  async listAgents(): Promise<AgentInfo[]> {
    const raw = await this.call<Record<string, unknown>>("agents.list");
    const agents = Array.isArray(raw?.agents) ? raw.agents : [];
    const defaultId = raw?.defaultId;
    return agents.map((a: Record<string, unknown>) => ({
      id: String(a.id ?? ""),
      name: String(a.name ?? a.id ?? ""),
      description: String(a.description ?? ""),
      isDefault: a.id === defaultId,
    }));
  }

  async getSkillsStatus(): Promise<SkillInfo[]> {
    const raw = await this.call<Record<string, unknown>>("skills.status");
    const skills = Array.isArray(raw?.skills) ? raw.skills : [];
    return skills.map((s: Record<string, unknown>) => ({
      name: String(s.name ?? ""),
      status: (s.active === true
        ? "active"
        : s.status === "error"
          ? "error"
          : "inactive") as SkillInfo["status"],
      queryCount: typeof s.queryCount === "number" ? s.queryCount : 0,
      lastUsedAt: s.lastUsedAt ? String(s.lastUsedAt) : undefined,
    }));
  }

  async getHealth(): Promise<{ status: string; uptime: number }> {
    return this.call<{ status: string; uptime: number }>("health");
  }

  async getPlan(sessionId: string): Promise<PlanInfo | null> {
    return this.call<PlanInfo | null>("plan.get", { sessionId });
  }

  async getTraceEvents(options?: { agentId?: string; limit?: number }): Promise<TraceEvent[]> {
    return this.call<TraceEvent[]>("trace.events", options ?? {});
  }

  async queryKg(query: string, limit?: number): Promise<KgEntry[]> {
    return this.call<KgEntry[]>("kg.query", {
      query,
      ...(limit !== undefined ? { limit } : {}),
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Module-level helpers                                               */
/* ------------------------------------------------------------------ */

function mapSessionStatus(kind: unknown): SessionInfo["status"] {
  switch (kind) {
    case "direct":
    case "group":
      return "active";
    case "global":
      return "idle";
    default:
      return "idle";
  }
}

/** Normalize a raw gateway message into our ChatMessage shape. */
function normalizeMessage(m: Record<string, unknown>): ChatMessage {
  const role =
    m.role === "assistant" || m.role === "user" || m.role === "system" ? m.role : "system";

  // Content can be a string or an array of content blocks
  let text = "";
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    text = (m.content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  } else if (typeof m.text === "string") {
    text = m.text;
  }

  const timestamp =
    typeof m.timestamp === "number"
      ? new Date(m.timestamp).toISOString()
      : typeof m.timestamp === "string"
        ? m.timestamp
        : new Date().toISOString();

  return { role, content: text, timestamp };
}
