/**
 * Session Teleportation
 *
 * Export/import session state as a shareable token.
 * Serializes session messages, agent config, and metadata
 * into a compressed base64 token that can be shared between devices.
 */

import { deflateSync, inflateSync } from "node:zlib";

export type TeleportPayload = {
  version: 1;
  timestamp: string;
  agentId: string;
  sessionKey: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
  }>;
  metadata: Record<string, unknown>;
};

export const MAX_EXPORT_MESSAGES = 100;
export const MAX_TOKEN_BYTES = 512 * 1024; // 512KB limit

const TELEPORT_MAGIC = "MYR1"; // Version identifier prefix

/**
 * Export session state to a shareable token.
 */
export function exportSession(payload: TeleportPayload): string {
  const json = JSON.stringify(payload);
  const compressed = deflateSync(Buffer.from(json, "utf-8"));
  const base64 = compressed.toString("base64url");
  return `${TELEPORT_MAGIC}${base64}`;
}

/**
 * Import session state from a token.
 */
export function importSession(token: string): TeleportPayload {
  if (!token.startsWith(TELEPORT_MAGIC)) {
    throw new Error("Invalid teleport token: missing magic prefix");
  }

  const base64 = token.slice(TELEPORT_MAGIC.length);
  const compressed = Buffer.from(base64, "base64url");

  let payload: TeleportPayload;
  try {
    const json = inflateSync(compressed).toString("utf-8");
    payload = JSON.parse(json) as TeleportPayload;
  } catch (err) {
    throw new Error(
      `Invalid teleport token: ${err instanceof Error ? err.message : "corrupt data"}`,
    );
  }

  if (payload.version !== 1) {
    throw new Error(`Unsupported teleport version: ${payload.version}`);
  }

  if (!payload.agentId || !payload.sessionKey || !Array.isArray(payload.messages)) {
    throw new Error("Invalid teleport payload: missing required fields");
  }

  return payload;
}

/**
 * Validates that a teleport payload doesn't exceed size limits.
 * Returns null if valid, or an error message string if invalid.
 */
export function validatePayloadSize(payload: TeleportPayload): string | null {
  if (payload.messages.length > MAX_EXPORT_MESSAGES) {
    return `Too many messages (${payload.messages.length}). Max: ${MAX_EXPORT_MESSAGES}`;
  }
  const json = JSON.stringify(payload);
  if (json.length > MAX_TOKEN_BYTES) {
    return `Payload too large (${(json.length / 1024).toFixed(1)}KB). Max: ${(MAX_TOKEN_BYTES / 1024).toFixed(0)}KB`;
  }
  return null;
}

/**
 * Estimate token size for display purposes.
 */
export function estimateTokenSize(token: string): {
  compressedBytes: number;
  messageCount: number;
} {
  const base64 = token.slice(TELEPORT_MAGIC.length);
  const compressedBytes = Math.ceil(base64.length * 0.75);

  let messageCount = 0;
  try {
    const compressed = Buffer.from(base64, "base64url");
    const json = inflateSync(compressed).toString("utf-8");
    const payload = JSON.parse(json) as { messages?: unknown[] };
    messageCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
  } catch {
    // Best-effort — corrupted tokens return 0
  }

  return { compressedBytes, messageCount };
}
