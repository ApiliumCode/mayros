import type { GatewayBrowserClient } from "../gateway.ts";

// ============================================================================
// Types
// ============================================================================

export type ToolCallRecord = {
  timestamp: number;
  toolName: string;
  durationMs: number;
  status: "ok" | "error";
  params?: string;
};

export type ToolMetrics = {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  lastCalledAt: number;
};

export type McpMetricsSnapshot = {
  startedAt: number;
  tools: ToolMetrics[];
  recentCalls: ToolCallRecord[];
  totalCalls: number;
  totalErrors: number;
};

export type McpServerStatus = {
  running: boolean;
  transport: "stdio" | "http";
  address?: string;
  toolCount: number;
  initialized: boolean;
  uptimeMs: number;
  sseSessionCount: number;
};

export type CortexHealthStatus = {
  status: "online" | "offline";
  latencyMs: number;
};

export type McpDashboardResponse = {
  status: McpServerStatus;
  metrics: McpMetricsSnapshot | null;
  cortexHealth: CortexHealthStatus | null;
};

// ============================================================================
// State
// ============================================================================

export type McpDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  mcpLoading: boolean;
  mcpError: string | null;
  mcpDashboard: McpDashboardResponse | null;
};

// ============================================================================
// Controller
// ============================================================================

export async function loadMcpDashboard(state: McpDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.mcpLoading) {
    return;
  }
  state.mcpLoading = true;
  state.mcpError = null;
  try {
    state.mcpDashboard = await state.client.request("mcp.dashboard", {});
  } catch (err) {
    state.mcpError = String(err);
  } finally {
    state.mcpLoading = false;
  }
}
