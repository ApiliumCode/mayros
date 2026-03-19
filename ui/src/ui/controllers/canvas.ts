/**
 * Canvas Controller — loads A2UI JSONL surfaces via the kaneru.canvas gateway method.
 */

import type { GatewayBrowserClient } from "../gateway.ts";

// ============================================================================
// State
// ============================================================================

export type CanvasState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  canvasLoading: boolean;
  canvasError: string | null;
  canvasJsonl: string | null;
  canvasActiveSurface: string;
};

// ============================================================================
// Controller
// ============================================================================

export async function loadCanvasSurface(state: CanvasState, surface?: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.canvasLoading) {
    return;
  }
  state.canvasLoading = true;
  state.canvasError = null;
  try {
    const params = surface && surface !== "all" ? { surface } : {};
    const response = (await state.client.request("kaneru.canvas", params)) as {
      jsonl: string;
      surfaceId: string;
    };
    state.canvasJsonl = response.jsonl;
  } catch (err) {
    state.canvasError = String(err);
  } finally {
    state.canvasLoading = false;
  }
}
