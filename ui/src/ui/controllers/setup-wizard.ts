import type { GatewayBrowserClient } from "../gateway.ts";
import type { SetupWizardState, SetupWizardStep } from "../views/setup-wizard.ts";

// ============================================================================
// Initial state
// ============================================================================

export function createInitialWizardState(): SetupWizardState {
  return {
    open: false,
    step: "venture",
    ventureName: "",
    ventureDirective: "",
    venturePrefix: "",
    ventureFuelLimit: "",
    agentName: "",
    agentRole: "",
    missionTitle: "",
    missionDescription: "",
    missionPriority: "medium",
    creating: false,
    error: null,
    result: null,
  };
}

// ============================================================================
// Navigation
// ============================================================================

const STEP_ORDER: SetupWizardStep[] = ["venture", "agent", "mission", "launch"];

export function wizardNext(state: SetupWizardState): void {
  const idx = STEP_ORDER.indexOf(state.step);
  if (idx < STEP_ORDER.length - 1) {
    state.step = STEP_ORDER[idx + 1];
  }
}

export function wizardBack(state: SetupWizardState): void {
  const idx = STEP_ORDER.indexOf(state.step);
  if (idx > 0) {
    state.step = STEP_ORDER[idx - 1];
    // Clear error when going back from launch
    state.error = null;
  }
}

// ============================================================================
// Create
// ============================================================================

export async function wizardCreate(
  state: SetupWizardState,
  client: GatewayBrowserClient,
): Promise<void> {
  state.creating = true;
  state.error = null;
  try {
    const result = await client.request("kaneru.setup", {
      ventureName: state.ventureName,
      ventureDirective: state.ventureDirective,
      venturePrefix: state.venturePrefix,
      ventureFuelLimit: state.ventureFuelLimit ? parseInt(state.ventureFuelLimit, 10) : 0,
      agentName: state.agentName,
      agentRole: state.agentRole,
      missionTitle: state.missionTitle,
      missionDescription: state.missionDescription,
      missionPriority: state.missionPriority || "medium",
    });
    state.result = result as { ventureId: string; agentId: string; missionId: string };
  } catch (err) {
    state.error = String(err);
  } finally {
    state.creating = false;
  }
}
