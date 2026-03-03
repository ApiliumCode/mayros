/**
 * MCP Tool Bridge.
 *
 * Converts MCP tool descriptors into Mayros tools. Handles:
 * - Tool kind classification by name/description heuristics
 * - Name prefixing for namespace isolation
 * - JSON Schema to TypeBox conversion
 */

import { Type } from "@sinclair/typebox";
import type { McpToolDescriptor } from "./transport.js";

// ============================================================================
// Types
// ============================================================================

export type BridgedTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  serverId: string;
  originalName: string;
};

// ============================================================================
// Tool Kind Classification
// ============================================================================

const READ_KEYWORDS = [
  "get",
  "list",
  "read",
  "fetch",
  "search",
  "query",
  "find",
  "show",
  "describe",
];
const WRITE_KEYWORDS = [
  "create",
  "update",
  "delete",
  "remove",
  "set",
  "put",
  "post",
  "write",
  "modify",
  "add",
];
const EXEC_KEYWORDS = ["run", "exec", "execute", "invoke", "call", "start", "stop", "restart"];
const ADMIN_KEYWORDS = ["admin", "manage", "config", "configure", "deploy", "install"];

/**
 * Extract the leading verb from a tool name. Tool names follow the convention
 * `verb_noun` or `verb-noun`, so we take the first segment.
 */
function extractLeadingVerb(name: string): string {
  return name.toLowerCase().split(/[_-]/)[0];
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    // Match keyword as whole word or as prefix/suffix separated by _ or -
    const pattern = new RegExp(`(?:^|[_-])${kw}(?:[_-]|$)|^${kw}`);
    return pattern.test(lower);
  });
}

function matchesKeywordsInDescription(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    // In descriptions, match word boundaries
    const pattern = new RegExp(`\\b${kw}\\b`);
    return pattern.test(lower);
  });
}

/**
 * Classify an MCP tool into a kind based on its name and description.
 *
 * The leading verb of the name is checked first for the strongest signal.
 * Falls back to scanning the full name, then the description.
 */
export function classifyMcpToolKind(name: string, description?: string): string {
  const verb = extractLeadingVerb(name);

  // Check leading verb first — strongest signal
  if (READ_KEYWORDS.includes(verb)) return "read";
  if (WRITE_KEYWORDS.includes(verb)) return "write";
  if (EXEC_KEYWORDS.includes(verb)) return "exec";
  if (ADMIN_KEYWORDS.includes(verb)) return "admin";

  // Check full name for non-leading keywords
  if (matchesKeywords(name, READ_KEYWORDS)) return "read";
  if (matchesKeywords(name, WRITE_KEYWORDS)) return "write";
  if (matchesKeywords(name, EXEC_KEYWORDS)) return "exec";
  if (matchesKeywords(name, ADMIN_KEYWORDS)) return "admin";

  // Try description as fallback
  if (description) {
    if (matchesKeywordsInDescription(description, READ_KEYWORDS)) return "read";
    if (matchesKeywordsInDescription(description, WRITE_KEYWORDS)) return "write";
    if (matchesKeywordsInDescription(description, EXEC_KEYWORDS)) return "exec";
    if (matchesKeywordsInDescription(description, ADMIN_KEYWORDS)) return "admin";
  }

  return "other";
}

// ============================================================================
// JSON Schema to TypeBox Conversion
// ============================================================================

/**
 * Convert a JSON Schema object into a TypeBox schema.
 *
 * Handles: string, number, integer, boolean, object (with properties), array (with items).
 * Unknown or complex types fall back to Type.Unsafe() as a pass-through.
 */
export function jsonSchemaToTypeBox(schema: Record<string, unknown>): unknown {
  if (!schema || typeof schema !== "object") {
    return Type.Object({});
  }

  const type = schema.type as string | undefined;

  switch (type) {
    case "string": {
      const opts: Record<string, unknown> = {};
      if (typeof schema.description === "string") opts.description = schema.description;
      if (typeof schema.minLength === "number") opts.minLength = schema.minLength;
      if (typeof schema.maxLength === "number") opts.maxLength = schema.maxLength;
      if (schema.enum && Array.isArray(schema.enum)) {
        return Type.Unsafe({ type: "string", enum: schema.enum, ...opts });
      }
      return Type.String(opts);
    }

    case "number":
    case "integer": {
      const opts: Record<string, unknown> = {};
      if (typeof schema.description === "string") opts.description = schema.description;
      if (typeof schema.minimum === "number") opts.minimum = schema.minimum;
      if (typeof schema.maximum === "number") opts.maximum = schema.maximum;
      return Type.Number(opts);
    }

    case "boolean": {
      const opts: Record<string, unknown> = {};
      if (typeof schema.description === "string") opts.description = schema.description;
      return Type.Boolean(opts);
    }

    case "object": {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required ?? []) as string[];

      if (!properties || Object.keys(properties).length === 0) {
        return Type.Object({});
      }

      const typeboxProps: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const converted = jsonSchemaToTypeBox(propSchema);
        if (required.includes(key)) {
          typeboxProps[key] = converted;
        } else {
          typeboxProps[key] = Type.Optional(converted as Parameters<typeof Type.Optional>[0]);
        }
      }
      return Type.Object(typeboxProps as Record<string, Parameters<typeof Type.Object>[0][string]>);
    }

    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      if (items) {
        const converted = jsonSchemaToTypeBox(items);
        return Type.Array(converted as Parameters<typeof Type.Array>[0]);
      }
      return Type.Array(Type.Unknown());
    }

    default:
      // Pass-through for unknown schemas
      return Type.Unsafe(schema);
  }
}

// ============================================================================
// Tool Bridging
// ============================================================================

/**
 * Bridge an MCP tool descriptor into a Mayros BridgedTool.
 *
 * Applies optional prefix to the tool name for namespace isolation.
 */
export function bridgeMcpTool(
  descriptor: McpToolDescriptor,
  serverId: string,
  prefix?: string,
): BridgedTool {
  const name = prefix ? `${prefix}_${descriptor.name}` : descriptor.name;
  const label = descriptor.name
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const description =
    descriptor.description ?? `MCP tool: ${descriptor.name} (server: ${serverId})`;

  const parameters = descriptor.inputSchema
    ? jsonSchemaToTypeBox(descriptor.inputSchema)
    : Type.Object({});

  return {
    name,
    label,
    description,
    parameters,
    serverId,
    originalName: descriptor.name,
  };
}
