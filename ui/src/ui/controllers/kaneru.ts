import type { GatewayBrowserClient } from "../gateway.ts";

// ============================================================================
// Types
// ============================================================================

export type SquadSummary = {
  id: string;
  name: string;
  status: string;
  memberCount: number;
  updatedAt: string;
};

export type RouteTableEntry = {
  stateKey: string;
  agentId: string;
  qValue: number;
};

export type KaneruDashboardResponse = {
  squads: SquadSummary[];
  routeTable: RouteTableEntry[];
  stats: {
    activeSquads: number;
    qTableSize: number;
    epsilon: number;
  };
};

// ============================================================================
// State
// ============================================================================

export type AvailableAgent = {
  agentId: string;
  role: string;
  expertise?: string;
};

export type KaneruDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  kaneruLoading: boolean;
  kaneruError: string | null;
  kaneruDashboard: KaneruDashboardResponse | null;
  // Squad builder state
  squadBuilderAgents: AvailableAgent[];
  squadBuilderSelected: string[];
  squadBuilderName: string;
  squadBuilderStrategy: string;
  squadBuilderCreating: boolean;
};

// ============================================================================
// Controller
// ============================================================================

export async function loadKaneruDashboard(state: KaneruDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kaneruLoading) {
    return;
  }
  state.kaneruLoading = true;
  state.kaneruError = null;
  try {
    state.kaneruDashboard = await state.client.request("kaneru.dashboard", {});
  } catch (err) {
    state.kaneruError = String(err);
  } finally {
    state.kaneruLoading = false;
  }
}
