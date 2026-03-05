/**
 * Minimal LSP types.
 *
 * Zero external dependencies — no vscode-languageserver-protocol.
 * Only the subset needed for hover, definition, completion, diagnostics.
 */

// ============================================================================
// LSP Core Types
// ============================================================================

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4; // Error, Warning, Info, Hint

export type LspDiagnostic = {
  range: LspRange;
  severity?: LspDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
};

export type LspHoverResult = {
  contents: string;
  range?: LspRange;
} | null;

export type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
};

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

// ============================================================================
// JSON-RPC Helpers
// ============================================================================

let nextId = 1;

export function createJsonRpcRequest(method: string, params?: unknown): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };
}

export function createJsonRpcNotification(method: string, params?: unknown): JsonRpcNotification {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

export function parseJsonRpcMessage(data: string): JsonRpcResponse | JsonRpcNotification | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.jsonrpc !== "2.0") return null;
    return parsed as JsonRpcResponse | JsonRpcNotification;
  } catch {
    return null;
  }
}

// ============================================================================
// Content-Length framing
// ============================================================================

export function encodeMessage(message: JsonRpcRequest | JsonRpcNotification): Buffer {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header), Buffer.from(body)]);
}

// ============================================================================
// Severity helpers
// ============================================================================

export function severityLabel(severity?: LspDiagnosticSeverity): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "unknown";
  }
}

export function severityFromLabel(label: string): LspDiagnosticSeverity | undefined {
  switch (label) {
    case "error":
      return 1;
    case "warning":
      return 2;
    case "info":
      return 3;
    case "hint":
      return 4;
    default:
      return undefined;
  }
}
