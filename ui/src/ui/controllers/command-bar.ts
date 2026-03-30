import type { GatewayBrowserClient } from "../gateway.ts";
import type { CommandBarState } from "../views/command-bar.ts";

// ============================================================================
// Initial state
// ============================================================================

export function createInitialCommandBarState(): CommandBarState {
  return {
    open: false,
    query: "",
    recording: false,
    processing: false,
    result: null,
    error: null,
    ventureContext: null,
    activeMissions: [],
  };
}

// ============================================================================
// Context loading
// ============================================================================

export async function loadCommandBarContext(
  state: CommandBarState,
  client: GatewayBrowserClient,
): Promise<void> {
  try {
    const response = (await client.request("ventures.dashboard", {})) as Record<string, unknown>;
    const stats = response.stats as Record<string, unknown> | undefined;
    const ventures = (response.ventures as Array<Record<string, unknown>>) ?? [];
    const missions = (response.missions as Array<Record<string, unknown>>) ?? [];

    const firstVenture = ventures[0];
    if (firstVenture) {
      state.ventureContext = {
        name: String(firstVenture.name ?? "Venture"),
        prefix: String(firstVenture.prefix ?? ""),
        missionCount: Number(firstVenture.missionCount ?? 0),
        activeMissions: Number(stats?.activeMissions ?? 0),
        fuelSpent: Number(stats?.totalFuelSpent ?? 0),
      };
    }

    state.activeMissions = missions
      .filter((m) => {
        const status = String(m.status ?? "").toLowerCase();
        return status === "active" || status === "in_progress" || status === "claimed";
      })
      .slice(0, 5)
      .map((m) => ({
        identifier: String(m.identifier ?? ""),
        title: String(m.title ?? ""),
        priority: String(m.priority ?? "medium"),
      }));
  } catch {
    // Context loading is best-effort — don't block the command bar
  }
}

// ============================================================================
// Command execution
// ============================================================================

export async function executeCommand(
  state: CommandBarState,
  client: GatewayBrowserClient,
  query: string,
): Promise<void> {
  state.processing = true;
  state.error = null;
  state.result = null;

  try {
    const lower = query.toLowerCase();

    if (lower.includes("fuel") || lower.includes("cost") || lower.includes("spend")) {
      const result = (await client.request("ventures.dashboard", {})) as Record<string, unknown>;
      const data = result.stats as Record<string, unknown> | undefined;
      state.result = `Fuel: $${(Number(data?.totalFuelSpent ?? 0) / 100).toFixed(2)} spent across ${data?.totalVentures ?? 0} ventures. ${data?.activeMissions ?? 0} active missions.`;
    } else if (lower.includes("mission") && (lower.includes("list") || lower.includes("show"))) {
      const result = (await client.request("ventures.dashboard", {})) as Record<string, unknown>;
      const missions = ((result.missions as Array<Record<string, unknown>>) ?? []).slice(0, 5);
      state.result =
        missions.length > 0
          ? missions.map((m) => `${m.identifier} [${m.priority}] ${m.title}`).join("\n")
          : "No missions found.";
    } else if (lower.includes("squad") || lower.includes("agent")) {
      const result = (await client.request("kaneru.dashboard", {})) as Record<string, unknown>;
      const data = result.stats as Record<string, unknown> | undefined;
      state.result = `${data?.activeSquads ?? 0} active squads, Q-table: ${data?.qTableSize ?? 0} entries, \u03B5=${(Number(data?.epsilon ?? 0) * 100).toFixed(1)}%`;
    } else if (lower.includes("decision")) {
      state.result = "Use 'mayros kaneru decisions list' for full decision history.";
    } else {
      state.result = `Command received: "${query}"\nUse the CLI for full capabilities: mayros kaneru --help`;
    }
  } catch (err) {
    state.error = String(err);
  } finally {
    state.processing = false;
  }
}

// ============================================================================
// Voice recognition
// ============================================================================

let recognition: unknown = null;

export function startVoiceRecognition(
  state: CommandBarState,
  onResult: (text: string) => void,
): void {
  const SpeechRecognition =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const SpeechCtor = SpeechRecognition as new () => Record<string, unknown>;
  const rec = new SpeechCtor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";

  rec.onresult = (event: unknown) => {
    const ev = event as { results: { 0: { 0: { transcript: string } } } };
    const text = ev.results[0][0].transcript;
    onResult(text);
    state.recording = false;
  };

  rec.onerror = () => {
    state.recording = false;
  };
  rec.onend = () => {
    state.recording = false;
  };

  (rec as { start: () => void }).start();
  recognition = rec;
  state.recording = true;
}

export function stopVoiceRecognition(state: CommandBarState): void {
  if (recognition) {
    (recognition as { stop: () => void }).stop();
    recognition = null;
  }
  state.recording = false;
}

export function isVoiceAvailable(): boolean {
  return (
    Boolean((window as unknown as Record<string, unknown>).SpeechRecognition) ||
    Boolean((window as unknown as Record<string, unknown>).webkitSpeechRecognition)
  );
}
