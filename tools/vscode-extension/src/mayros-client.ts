import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  SessionInfo,
  AgentInfo,
  SkillInfo,
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

  private readonly requestTimeoutMs: number;

  constructor(
    private url: string,
    private options: ClientOptions,
    wsFactory?: WebSocketFactory,
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.wsFactory = wsFactory;
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
          this._connected = true;
          this.reconnectAttempts = 0;
          this.emit("connected");
          resolve();
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
    const request: GatewayRequest = { id, method };
    if (params) request.params = params;

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
    let parsed: GatewayResponse | GatewayEvent;
    try {
      parsed = JSON.parse(raw) as GatewayResponse | GatewayEvent;
    } catch {
      return; // ignore malformed messages
    }

    // Server-push event
    if ("event" in parsed && typeof parsed.event === "string") {
      this.emit("event", parsed as GatewayEvent);
      this.emit(`event:${parsed.event}`, (parsed as GatewayEvent).data);
      return;
    }

    // RPC response
    const resp = parsed as GatewayResponse;
    if (!resp.id) return;
    const pending = this.pending.get(resp.id);
    if (!pending) return;
    this.pending.delete(resp.id);
    clearTimeout(pending.timer);

    if (resp.error) {
      pending.reject(new Error(`Gateway error ${resp.error.code}: ${resp.error.message}`));
    } else {
      pending.resolve(resp.result);
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

  /* ---- domain methods ---- */

  async listSessions(): Promise<SessionInfo[]> {
    return this.call<SessionInfo[]>("sessions.list");
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    await this.call<void>("chat.send", { sessionId, content });
  }

  async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
    return this.call<ChatMessage[]>("chat.history", { sessionId });
  }

  async abortChat(sessionId: string): Promise<void> {
    await this.call<void>("chat.abort", { sessionId });
  }

  async listAgents(): Promise<AgentInfo[]> {
    return this.call<AgentInfo[]>("agents.list");
  }

  async getSkillsStatus(): Promise<SkillInfo[]> {
    return this.call<SkillInfo[]>("skills.status");
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
