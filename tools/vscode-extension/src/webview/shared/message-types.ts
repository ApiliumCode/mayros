/* ------------------------------------------------------------------ */
/*  Webview <-> Extension message protocol (browser-side types)        */
/*                                                                     */
/*  These mirror the types in src/types.ts but are kept separate so    */
/*  webview bundles don't pull in Node/vscode dependencies.            */
/* ------------------------------------------------------------------ */

/** Image attachment sent with a chat message. */
export type ChatAttachmentView = {
  name: string;
  mimeType: string;
  /** Base64-encoded image data. */
  dataBase64: string;
};

/** Messages sent from the webview to the extension host. */
export type WebviewMessage =
  | { type: "send"; sessionId: string; content: string; attachments?: ChatAttachmentView[] }
  | { type: "history"; sessionId: string }
  | { type: "abort"; sessionId: string }
  | { type: "sessions" }
  | { type: "plan.refresh"; sessionId: string }
  | { type: "trace.refresh"; agentId?: string; limit?: number }
  | { type: "trace.filter"; filterType: string; filterValue: string }
  | { type: "kg.search"; query: string; limit?: number }
  | { type: "kg.explore"; subject: string };

/** Messages sent from the extension host to the webview. */
export type ExtensionMessage =
  | { type: "sessions"; sessions: SessionView[] }
  | { type: "history"; messages: ChatMessageView[] }
  | { type: "message"; message: ChatMessageView }
  | {
      type: "stream";
      runId: string;
      state: "delta" | "final" | "aborted" | "error";
      content: string;
    }
  | { type: "error"; text: string }
  | { type: "connectionStatus"; connected: boolean }
  | { type: "plan.data"; plan: PlanView | null }
  | { type: "trace.data"; events: TraceEventView[] }
  | { type: "kg.results"; entries: KgEntryView[] };

/* ---- Slim view types (no importing from Node modules) ---- */

export type SessionView = {
  id: string;
  status: string;
  agentId: string;
  startedAt: string;
  messageCount: number;
};

export type ChatMessageView = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: Array<{ name: string; id: string }>;
  attachments?: ChatAttachmentView[];
};

export type PlanView = {
  id: string;
  phase: string;
  discoveries: Array<{ text: string; source: string }>;
  assertions: Array<{
    subject: string;
    predicate: string;
    verified: boolean;
  }>;
  createdAt: string;
};

export type TraceEventView = {
  id: string;
  type: string;
  agentId: string;
  timestamp: string;
  data: Record<string, unknown>;
  parentId?: string;
};

export type KgEntryView = {
  subject: string;
  predicate: string;
  object: string;
  id: string;
};
