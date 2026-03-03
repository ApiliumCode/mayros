/* ------------------------------------------------------------------ */
/*  Gateway RPC protocol                                              */
/* ------------------------------------------------------------------ */

export type GatewayRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayResponse = {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
};

export type GatewayEvent = {
  event: string;
  data: unknown;
};

/* ------------------------------------------------------------------ */
/*  Domain types                                                       */
/* ------------------------------------------------------------------ */

export type SessionInfo = {
  id: string;
  status: "active" | "idle" | "ended";
  agentId: string;
  startedAt: string;
  messageCount: number;
};

export type AgentInfo = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
};

export type SkillInfo = {
  name: string;
  status: "active" | "inactive" | "error";
  queryCount: number;
  lastUsedAt?: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: Array<{ name: string; id: string }>;
};

export type PlanPhase = "idle" | "explore" | "assert" | "approve" | "execute" | "done";

export type PlanInfo = {
  id: string;
  phase: PlanPhase;
  discoveries: Array<{ text: string; source: string }>;
  assertions: Array<{
    subject: string;
    predicate: string;
    verified: boolean;
  }>;
  createdAt: string;
};

export type TraceEvent = {
  id: string;
  type: string;
  agentId: string;
  timestamp: string;
  data: Record<string, unknown>;
  parentId?: string;
};

export type KgEntry = {
  subject: string;
  predicate: string;
  object: string;
  id: string;
};

/* ------------------------------------------------------------------ */
/*  Client events                                                      */
/* ------------------------------------------------------------------ */

export type MayrosClientEvents = {
  connected: () => void;
  disconnected: (reason: string) => void;
  error: (error: Error) => void;
  event: (event: GatewayEvent) => void;
};

/* ------------------------------------------------------------------ */
/*  Webview <-> Extension message protocol                             */
/* ------------------------------------------------------------------ */

export type WebviewToExtension =
  | { type: "send"; sessionId: string; content: string }
  | { type: "history"; sessionId: string }
  | { type: "abort"; sessionId: string }
  | { type: "sessions" }
  | { type: "plan.refresh"; sessionId: string }
  | { type: "trace.refresh"; agentId?: string; limit?: number }
  | { type: "trace.filter"; filterType: string; filterValue: string }
  | { type: "kg.search"; query: string; limit?: number }
  | { type: "kg.explore"; subject: string };

export type ExtensionToWebview =
  | { type: "sessions"; sessions: SessionInfo[] }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "error"; text: string }
  | { type: "plan.data"; plan: PlanInfo | null }
  | { type: "trace.data"; events: TraceEvent[] }
  | { type: "kg.results"; entries: KgEntry[] };
