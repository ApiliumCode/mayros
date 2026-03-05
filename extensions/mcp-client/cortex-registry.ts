/**
 * MCP Cortex Registry.
 *
 * Registers MCP server and tool metadata as RDF triples in AIngle Cortex.
 * Follows the same subject/predicate pattern as TeamManager.
 *
 * Triple namespace:
 *   Subject: ${ns}:mcp:server:${serverId}
 *     Predicates: serverName, transport, connectedAt, toolCount, status
 *
 *   Subject: ${ns}:mcp:tool:${serverId}:${toolName}
 *     Predicates: server, toolName, description, kind, inputSchema,
 *                 registeredAt, lastUsedAt, usageCount, status
 */

import type { CortexClientLike } from "../shared/cortex-client.js";

// ============================================================================
// Helpers
// ============================================================================

function serverSubject(ns: string, serverId: string): string {
  return `${ns}:mcp:server:${serverId}`;
}

function serverPred(ns: string, field: string): string {
  return `${ns}:mcp:${field}`;
}

function toolSubject(ns: string, serverId: string, toolName: string): string {
  return `${ns}:mcp:tool:${serverId}:${toolName}`;
}

// ============================================================================
// McpCortexRegistry
// ============================================================================

export class McpCortexRegistry {
  constructor(
    private readonly cortex: CortexClientLike,
    private readonly ns: string,
  ) {}

  /**
   * Register (or update) an MCP server's metadata in Cortex.
   */
  async registerServer(
    serverId: string,
    config: { name?: string; transport: string; toolCount: number },
  ): Promise<void> {
    const subject = serverSubject(this.ns, serverId);
    const now = new Date().toISOString();

    const fields: Array<[string, string | number]> = [
      ["serverName", config.name ?? serverId],
      ["transport", config.transport],
      ["connectedAt", now],
      ["toolCount", config.toolCount],
      ["status", "connected"],
    ];

    for (const [field, value] of fields) {
      await this.updateField(subject, serverPred(this.ns, field), value);
    }
  }

  /**
   * Register a tool from an MCP server in Cortex.
   */
  async registerTool(
    serverId: string,
    tool: { name: string; description?: string; kind: string; inputSchema?: string },
  ): Promise<void> {
    const subject = toolSubject(this.ns, serverId, tool.name);
    const now = new Date().toISOString();

    const fields: Array<[string, string | number]> = [
      ["server", serverId],
      ["toolName", tool.name],
      ["description", tool.description ?? ""],
      ["kind", tool.kind],
      ["inputSchema", tool.inputSchema ?? "{}"],
      ["registeredAt", now],
      ["lastUsedAt", ""],
      ["usageCount", 0],
      ["status", "active"],
    ];

    for (const [field, value] of fields) {
      await this.updateField(subject, serverPred(this.ns, field), value);
    }
  }

  /**
   * Update the usage count and last-used timestamp for a tool.
   */
  async updateToolUsage(serverId: string, toolName: string): Promise<void> {
    const subject = toolSubject(this.ns, serverId, toolName);
    const now = new Date().toISOString();

    // Read current usage count
    const countPred = serverPred(this.ns, "usageCount");
    const existing = await this.cortex.listTriples({
      subject,
      predicate: countPred,
      limit: 1,
    });

    let currentCount = 0;
    if (existing.triples.length > 0) {
      const val = existing.triples[0].object;
      currentCount = typeof val === "number" ? val : Number.parseInt(String(val), 10) || 0;
    }

    await this.updateField(subject, countPred, currentCount + 1);
    await this.updateField(subject, serverPred(this.ns, "lastUsedAt"), now);
  }

  /**
   * Unregister a server and mark its tools as inactive.
   */
  async unregisterServer(serverId: string): Promise<void> {
    const subject = serverSubject(this.ns, serverId);

    // Mark server as disconnected
    await this.updateField(subject, serverPred(this.ns, "status"), "disconnected");

    // Find and mark all tools as inactive
    const toolResult = await this.cortex.patternQuery({
      predicate: serverPred(this.ns, "server"),
      object: serverId,
      limit: 200,
    });

    for (const match of toolResult.matches) {
      await this.updateField(String(match.subject), serverPred(this.ns, "status"), "inactive");
    }
  }

  /**
   * Get all registered servers from Cortex.
   */
  async getRegisteredServers(): Promise<
    Array<{
      serverId: string;
      name: string;
      transport: string;
      toolCount: number;
      status: string;
    }>
  > {
    const result = await this.cortex.patternQuery({
      predicate: serverPred(this.ns, "serverName"),
      limit: 200,
    });

    const prefix = `${this.ns}:mcp:server:`;
    const servers: Array<{
      serverId: string;
      name: string;
      transport: string;
      toolCount: number;
      status: string;
    }> = [];

    for (const match of result.matches) {
      const sub = String(match.subject);
      if (!sub.startsWith(prefix)) continue;
      const serverId = sub.slice(prefix.length);
      const name = String(match.object);

      // Fetch additional fields
      const fields = await this.getFields(sub, ["transport", "toolCount", "status"]);

      servers.push({
        serverId,
        name,
        transport: fields.transport ?? "unknown",
        toolCount: Number.parseInt(fields.toolCount ?? "0", 10) || 0,
        status: fields.status ?? "unknown",
      });
    }

    return servers;
  }

  /**
   * Get registered tools, optionally filtered by server.
   */
  async getRegisteredTools(serverId?: string): Promise<
    Array<{
      serverId: string;
      toolName: string;
      kind: string;
      usageCount: number;
    }>
  > {
    const query = serverId
      ? { predicate: serverPred(this.ns, "server"), object: serverId as string, limit: 200 }
      : { predicate: serverPred(this.ns, "toolName"), limit: 200 };

    const result = await this.cortex.patternQuery(query);

    const tools: Array<{
      serverId: string;
      toolName: string;
      kind: string;
      usageCount: number;
    }> = [];

    for (const match of result.matches) {
      const sub = String(match.subject);
      const fields = await this.getFields(sub, ["server", "toolName", "kind", "usageCount"]);

      tools.push({
        serverId: fields.server ?? "",
        toolName: fields.toolName ?? "",
        kind: fields.kind ?? "other",
        usageCount: Number.parseInt(fields.usageCount ?? "0", 10) || 0,
      });
    }

    return tools;
  }

  // ---------- internal helpers ----------

  private async updateField(
    subject: string,
    predicate: string,
    value: string | number,
  ): Promise<void> {
    // Delete existing triple for this field
    const existing = await this.cortex.listTriples({
      subject,
      predicate,
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.cortex.deleteTriple(t.id);
    }

    // Create new triple
    await this.cortex.createTriple({
      subject,
      predicate,
      object: typeof value === "number" ? value : String(value),
    });
  }

  private async getFields(subject: string, fields: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const field of fields) {
      const triples = await this.cortex.listTriples({
        subject,
        predicate: serverPred(this.ns, field),
        limit: 1,
      });
      if (triples.triples.length > 0) {
        const val = triples.triples[0].object;
        result[field] =
          typeof val === "object" && val !== null && "node" in val
            ? String((val as { node: string }).node)
            : String(val);
      }
    }

    return result;
  }
}
