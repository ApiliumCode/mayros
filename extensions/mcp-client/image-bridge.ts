/**
 * MCP Image Content Bridge.
 *
 * Handles `type: "image"` content blocks in MCP tool responses,
 * converting them to Anthropic-compatible image content blocks
 * for the agent.
 */

// ============================================================================
// Types
// ============================================================================

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type AgentContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

// ============================================================================
// Extract
// ============================================================================

/**
 * Extract typed content blocks from raw MCP response content.
 * Separates text and image blocks; skips malformed entries.
 */
export function extractMcpContent(
  rawContent: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): McpContentBlock[] {
  const blocks: McpContentBlock[] = [];

  for (const item of rawContent) {
    if (item.type === "image") {
      // Image block: must have data and mimeType
      if (item.data && item.mimeType) {
        blocks.push({ type: "image", data: item.data, mimeType: item.mimeType });
      }
      // Skip images with missing data or mimeType
    } else if (item.type === "text") {
      if (item.text) {
        blocks.push({ type: "text", text: item.text });
      }
    } else {
      // Unknown type — treat as text if text field is present
      if (item.text) {
        blocks.push({ type: "text", text: item.text });
      }
    }
  }

  return blocks;
}

// ============================================================================
// Format
// ============================================================================

/**
 * Convert MCP content blocks to agent-compatible format.
 * Images become Anthropic-style base64 image blocks.
 */
export function formatMcpResponse(blocks: McpContentBlock[]): AgentContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "image") {
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: block.mimeType,
          data: block.data,
        },
      };
    }
    return { type: "text" as const, text: block.text };
  });
}

// ============================================================================
// Convenience: one-step conversion
// ============================================================================

/**
 * Check whether raw MCP content contains any image blocks.
 */
export function hasImageContent(
  rawContent: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): boolean {
  return rawContent.some((c) => c.type === "image" && c.data && c.mimeType);
}

/**
 * Convert raw MCP content to agent content blocks.
 * Text-only responses return a single text block.
 * Mixed/image responses return full content blocks array.
 */
export function bridgeMcpContent(
  rawContent: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): AgentContentBlock[] {
  const extracted = extractMcpContent(rawContent);

  if (extracted.length === 0) {
    return [{ type: "text", text: "(empty response)" }];
  }

  return formatMcpResponse(extracted);
}
