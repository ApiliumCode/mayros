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
  availableAgents?: AvailableAgent[];
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
    const response = (await state.client.request(
      "kaneru.dashboard",
      {},
    )) as KaneruDashboardResponse;
    state.kaneruDashboard = response;
    // Populate squad builder agents from response
    if (response.availableAgents) {
      state.squadBuilderAgents = response.availableAgents;
    }
  } catch (err) {
    state.kaneruError = String(err);
  } finally {
    state.kaneruLoading = false;
  }
}
