import type { GatewayBrowserClient } from "../gateway.ts";

// ============================================================================
// Types
// ============================================================================

export type VentureSummary = {
  id: string;
  name: string;
  status: string;
  prefix: string;
  fuelLimit: number;
  fuelSpent: number;
  agentCount: number;
  missionCount: number;
};

export type MissionSummary = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  claimedBy: string | null;
};

export type ChainNodeData = {
  agentId: string;
  role: string;
  escalatesTo: string | null;
  children: ChainNodeData[];
};

export type VentureDashboardResponse = {
  ventures: VentureSummary[];
  missions: MissionSummary[];
  chain: ChainNodeData[];
  stats: {
    totalVentures: number;
    activeMissions: number;
    totalFuelSpent: number;
  };
};

// ============================================================================
// State
// ============================================================================

export type VentureDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  venturesLoading: boolean;
  venturesError: string | null;
  venturesDashboard: VentureDashboardResponse | null;
};

// ============================================================================
// Controller
// ============================================================================

export async function loadVenturesDashboard(state: VentureDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.venturesLoading) {
    return;
  }
  state.venturesLoading = true;
  state.venturesError = null;
  try {
    state.venturesDashboard = await state.client.request("ventures.dashboard", {});
  } catch (err) {
    state.venturesError = String(err);
  } finally {
    state.venturesLoading = false;
  }
}
