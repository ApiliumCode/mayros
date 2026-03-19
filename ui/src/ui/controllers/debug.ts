import type { GatewayBrowserClient } from "../gateway.ts";
import type { HealthSnapshot, StatusSummary } from "../types.ts";

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
};

export async function loadDebug(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  try {
    const results = await Promise.allSettled([
      state.client.request("status", {}),
      state.client.request("health", {}),
      state.client.request("models.list", {}),
      state.client.request("last-heartbeat", {}),
    ]);
    if (results[0].status === "fulfilled") {
      state.debugStatus = results[0].value as StatusSummary;
    }
    if (results[1].status === "fulfilled") {
      state.debugHealth = results[1].value as HealthSnapshot;
    }
    if (results[2].status === "fulfilled") {
      const modelPayload = results[2].value as { models?: unknown[] } | undefined;
      state.debugModels = Array.isArray(modelPayload?.models) ? modelPayload?.models : [];
    }
    if (results[3].status === "fulfilled") {
      state.debugHeartbeat = results[3].value;
    }
    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length > 0) {
      state.debugCallError = errors
        .map((r) => String((r as PromiseRejectedResult).reason))
        .join("; ");
    }
  } catch (err) {
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function callDebugMethod(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}
