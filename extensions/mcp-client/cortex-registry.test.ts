/**
 * Cortex Registry Tests
 *
 * Tests cover: registerServer, registerTool, updateToolUsage,
 * unregisterServer, getRegisteredServers, getRegisteredTools.
 * All with mock CortexClient (same pattern as team-manager.test.ts).
 */

import { describe, it, expect } from "vitest";
import { McpCortexRegistry } from "./cortex-registry.js";

// ============================================================================
// Mock Cortex Client
// ============================================================================

function createMockClient() {
  const triples: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string | number | boolean | { node: string };
  }> = [];
  let nextId = 1;

  return {
    triples,
    async createTriple(req: {
      subject: string;
      predicate: string;
      object: string | number | boolean | { node: string };
    }) {
      const triple = { id: String(nextId++), ...req };
      triples.push(triple);
      return triple;
    },
    async listTriples(query: { subject?: string; predicate?: string; limit?: number }) {
      const filtered = triples.filter((t) => {
        if (query.subject && t.subject !== query.subject) return false;
        if (query.predicate && t.predicate !== query.predicate) return false;
        return true;
      });
      const limited = filtered.slice(0, query.limit ?? 100);
      return { triples: limited, total: filtered.length };
    },
    async patternQuery(req: {
      subject?: string;
      predicate?: string;
      object?: string | number | boolean | { node: string };
      limit?: number;
    }) {
      const filtered = triples.filter((t) => {
        if (req.subject && t.subject !== req.subject) return false;
        if (req.predicate && t.predicate !== req.predicate) return false;
        if (req.object !== undefined) {
          if (JSON.stringify(req.object) !== JSON.stringify(t.object)) return false;
        }
        return true;
      });
      const limited = filtered.slice(0, req.limit ?? 100);
      return { matches: limited, total: filtered.length };
    },
    async deleteTriple(id: string) {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("McpCortexRegistry", () => {
  describe("registerServer", () => {
    it("creates triples for server metadata", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("fs-server", {
        name: "Filesystem Server",
        transport: "stdio",
        toolCount: 5,
      });

      const serverTriples = client.triples.filter(
        (t) => t.subject === "mayros:mcp:server:fs-server",
      );
      expect(serverTriples.length).toBeGreaterThanOrEqual(5); // name, transport, connectedAt, toolCount, status
    });

    it("stores correct server name", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("api", { name: "API Server", transport: "http", toolCount: 3 });

      const nameTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:server:api" && t.predicate === "mayros:mcp:serverName",
      );
      expect(nameTriple).toBeTruthy();
      expect(nameTriple!.object).toBe("API Server");
    });

    it("uses serverId as name when name not provided", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("my-srv", { transport: "sse", toolCount: 1 });

      const nameTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:server:my-srv" && t.predicate === "mayros:mcp:serverName",
      );
      expect(nameTriple!.object).toBe("my-srv");
    });

    it("sets status to connected", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("srv", { transport: "http", toolCount: 0 });

      const statusTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:server:srv" && t.predicate === "mayros:mcp:status",
      );
      expect(statusTriple!.object).toBe("connected");
    });
  });

  describe("registerTool", () => {
    it("creates triples for tool metadata", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", {
        name: "read_file",
        description: "Read a file",
        kind: "read",
        inputSchema: '{"type":"object"}',
      });

      const toolTriples = client.triples.filter(
        (t) => t.subject === "mayros:mcp:tool:srv:read_file",
      );
      // server, toolName, description, kind, inputSchema, registeredAt, lastUsedAt, usageCount, status
      expect(toolTriples.length).toBeGreaterThanOrEqual(9);
    });

    it("stores correct tool kind", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", {
        name: "write_data",
        kind: "write",
      });

      const kindTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:tool:srv:write_data" && t.predicate === "mayros:mcp:kind",
      );
      expect(kindTriple!.object).toBe("write");
    });

    it("initializes usage count to 0", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", { name: "my_tool", kind: "other" });

      const countTriple = client.triples.find(
        (t) =>
          t.subject === "mayros:mcp:tool:srv:my_tool" && t.predicate === "mayros:mcp:usageCount",
      );
      expect(countTriple!.object).toBe(0);
    });
  });

  describe("updateToolUsage", () => {
    it("increments usage count", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", { name: "tool1", kind: "read" });
      await registry.updateToolUsage("srv", "tool1");

      const countTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:tool:srv:tool1" && t.predicate === "mayros:mcp:usageCount",
      );
      expect(countTriple!.object).toBe(1);
    });

    it("increments usage count multiple times", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", { name: "tool1", kind: "read" });
      await registry.updateToolUsage("srv", "tool1");
      await registry.updateToolUsage("srv", "tool1");
      await registry.updateToolUsage("srv", "tool1");

      const countTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:tool:srv:tool1" && t.predicate === "mayros:mcp:usageCount",
      );
      expect(countTriple!.object).toBe(3);
    });

    it("updates lastUsedAt timestamp", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", { name: "tool1", kind: "read" });

      const before = new Date().toISOString();
      await registry.updateToolUsage("srv", "tool1");

      const lastUsed = client.triples.find(
        (t) =>
          t.subject === "mayros:mcp:tool:srv:tool1" &&
          t.predicate === "mayros:mcp:lastUsedAt" &&
          t.object !== "",
      );
      expect(lastUsed).toBeTruthy();
      expect(String(lastUsed!.object) >= before).toBe(true);
    });
  });

  describe("unregisterServer", () => {
    it("marks server as disconnected", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("srv", { transport: "http", toolCount: 1 });
      await registry.unregisterServer("srv");

      const statusTriple = client.triples.find(
        (t) => t.subject === "mayros:mcp:server:srv" && t.predicate === "mayros:mcp:status",
      );
      expect(statusTriple!.object).toBe("disconnected");
    });

    it("marks tools as inactive", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("srv", { transport: "http", toolCount: 2 });
      await registry.registerTool("srv", { name: "tool1", kind: "read" });
      await registry.registerTool("srv", { name: "tool2", kind: "write" });

      await registry.unregisterServer("srv");

      const tool1Status = client.triples.find(
        (t) => t.subject === "mayros:mcp:tool:srv:tool1" && t.predicate === "mayros:mcp:status",
      );
      const tool2Status = client.triples.find(
        (t) => t.subject === "mayros:mcp:tool:srv:tool2" && t.predicate === "mayros:mcp:status",
      );

      expect(tool1Status!.object).toBe("inactive");
      expect(tool2Status!.object).toBe("inactive");
    });
  });

  describe("getRegisteredServers", () => {
    it("returns registered servers", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerServer("srv-a", {
        name: "Server A",
        transport: "http",
        toolCount: 3,
      });
      await registry.registerServer("srv-b", {
        name: "Server B",
        transport: "stdio",
        toolCount: 1,
      });

      const servers = await registry.getRegisteredServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.serverId).sort()).toEqual(["srv-a", "srv-b"]);
    });

    it("returns empty array when no servers registered", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      const servers = await registry.getRegisteredServers();
      expect(servers).toHaveLength(0);
    });
  });

  describe("getRegisteredTools", () => {
    it("returns tools for a specific server", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv", { name: "tool1", kind: "read" });
      await registry.registerTool("srv", { name: "tool2", kind: "write" });
      await registry.registerTool("other", { name: "tool3", kind: "exec" });

      const tools = await registry.getRegisteredTools("srv");
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.toolName).sort()).toEqual(["tool1", "tool2"]);
    });

    it("returns all tools when no serverId specified", async () => {
      const client = createMockClient();
      const registry = new McpCortexRegistry(client as never, "mayros");

      await registry.registerTool("srv-a", { name: "t1", kind: "read" });
      await registry.registerTool("srv-b", { name: "t2", kind: "write" });

      const tools = await registry.getRegisteredTools();
      expect(tools).toHaveLength(2);
    });
  });
});
