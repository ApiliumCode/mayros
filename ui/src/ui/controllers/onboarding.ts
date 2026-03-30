import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  OnboardingState,
  OnboardingStep,
  OnboardingProvider,
} from "../views/onboarding-wizard.ts";

// ============================================================================
// Initial state
// ============================================================================

export function createInitialOnboardingState(): OnboardingState {
  return {
    open: false,
    step: "provider",
    provider: null,
    apiKey: "",
    selectedActivity: "all",
    localModel: "llama3.1:8b",
    ollamaDetected: false,
    ollamaInstalledModels: [],
    agentName: "Atlas",
    detectedVramMB: 4096,
    detectedGpuName: "",
    saving: false,
    error: null,
    gatewayOk: false,
    cortexOk: false,
  };
}

// ============================================================================
// Navigation
// ============================================================================

const STEP_ORDER: OnboardingStep[] = ["provider", "apikey", "ready"];

export function onboardingNext(state: OnboardingState): void {
  const idx = STEP_ORDER.indexOf(state.step);
  if (idx < STEP_ORDER.length - 1) {
    state.step = STEP_ORDER[idx + 1];
    state.error = null;
  }
}

export function onboardingBack(state: OnboardingState): void {
  const idx = STEP_ORDER.indexOf(state.step);
  if (idx > 0) {
    state.step = STEP_ORDER[idx - 1];
    state.error = null;
  }
}

// ============================================================================
// Save config via gateway
// ============================================================================

export async function saveOnboardingConfig(
  state: OnboardingState,
  client: GatewayBrowserClient,
): Promise<void> {
  state.saving = true;
  state.error = null;
  try {
    const model =
      state.provider === "local"
        ? `ollama/${state.localModel}`
        : state.provider === "anthropic"
          ? "anthropic/claude-sonnet-4-20250514"
          : state.provider === "openai"
            ? "openai/gpt-4o"
            : state.provider === "google"
              ? "google/gemini-2.0-flash"
              : "";

    await client.request("onboarding.save", {
      provider: state.provider,
      apiKey: state.provider !== "local" ? state.apiKey : "",
      model,
      agentName: state.agentName.trim() || "Atlas",
    });
  } catch (err) {
    state.error = `Failed to save configuration: ${err instanceof Error ? err.message : String(err)}`;
    throw err;
  } finally {
    state.saving = false;
  }
}

// ============================================================================
// Check onboarding status
// ============================================================================

export async function checkOnboardingStatus(
  state: OnboardingState,
  client: GatewayBrowserClient,
): Promise<void> {
  try {
    const result = (await client.request("onboarding.status", {})) as {
      onboarded: boolean;
      gateway: boolean;
      cortex: boolean;
    };
    state.gatewayOk = result.gateway;
    state.cortexOk = result.cortex;
    if (!result.onboarded) {
      state.open = true;
      state.step = "provider";
    }
  } catch {
    // Gateway may not support onboarding.status yet — show wizard
    // so new users always get guided setup. They can close it.
    state.open = true;
    state.step = "provider";
  }
}

// ============================================================================
// Detect Ollama
// ============================================================================

export async function detectOllama(
  state: OnboardingState,
  client?: GatewayBrowserClient | null,
): Promise<void> {
  // Always use gateway proxy (direct browser fetch blocked by CSP)
  if (!client) {
    state.ollamaDetected = false;
    return;
  }
  try {
    const result = (await client.request("onboarding.detectOllama", {})) as {
      detected: boolean;
      models?: string[];
    };
    state.ollamaDetected = result.detected;
    if (result.models) {
      state.ollamaInstalledModels = result.models;
    }
  } catch {
    state.ollamaDetected = false;
  }
}

/**
 * Fetch the list of models already downloaded in Ollama.
 * Always uses the gateway proxy (direct browser fetch is blocked by CSP).
 */
export async function fetchOllamaModels(
  state: OnboardingState,
  client?: GatewayBrowserClient | null,
): Promise<void> {
  if (!client) return;
  try {
    const result = (await client.request("onboarding.detectOllama", {})) as {
      detected: boolean;
      models?: string[];
    };
    state.ollamaDetected = result.detected;
    if (result.models) {
      state.ollamaInstalledModels = result.models;
    }
  } catch {
    // gateway doesn't support model listing yet
  }
}

// ============================================================================
// Detect GPU via gateway
// ============================================================================

export async function detectGPU(
  state: OnboardingState,
  client?: GatewayBrowserClient | null,
): Promise<void> {
  if (!client) return;
  try {
    const result = (await client.request("onboarding.detectGPU", {})) as {
      vendor: string;
      name: string;
      vramMB: number;
    };
    state.detectedVramMB = result.vramMB;
    state.detectedGpuName = result.name || `${result.vendor} (${result.vramMB}MB)`;
  } catch {
    // Gateway doesn't support GPU detection — keep defaults
  }
}
