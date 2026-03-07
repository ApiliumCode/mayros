import type { GatewayBrowserClient } from "../gateway.ts";

export type CortexStatusResponse = {
  status: "online" | "offline";
  sidecar: string;
  endpoint: string;
  autoStart: boolean;
  version: string | null;
  uptime: number | null;
  triples: number | null;
  subjects: number | null;
  pendingWrites: number;
};

export type TripleEntry = {
  id?: string;
  subject: string;
  predicate: string;
  object: unknown;
  created_at?: string;
};

export type CortexBrowseFilter = {
  subject?: string;
  predicate?: string;
  limit: number;
  offset: number;
};

export type CortexState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  cortexLoading: boolean;
  cortexStatus: CortexStatusResponse | null;
  cortexError: string | null;
  cortexTriples: { triples: TripleEntry[]; total: number } | null;
  cortexSubjects: { subjects: string[]; total: number } | null;
  cortexPredicates: { predicates: string[]; total: number } | null;
  cortexBrowseLoading: boolean;
  cortexBrowseError: string | null;
  cortexBrowseFilter: CortexBrowseFilter;
};

export async function loadCortexStatus(state: CortexState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.cortexLoading) {
    return;
  }
  state.cortexLoading = true;
  state.cortexError = null;
  try {
    state.cortexStatus = await state.client.request("cortex.status", {});
  } catch (err) {
    state.cortexError = String(err);
  } finally {
    state.cortexLoading = false;
  }
}

export async function reconnectCortex(state: CortexState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.cortexLoading = true;
  state.cortexError = null;
  try {
    await state.client.request("cortex.reconnect", {});
    // Refresh status after reconnect
    state.cortexStatus = await state.client.request("cortex.status", {});
  } catch (err) {
    state.cortexError = String(err);
  } finally {
    state.cortexLoading = false;
  }
}

export async function loadCortexTriples(state: CortexState, filter?: Partial<CortexBrowseFilter>) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.cortexBrowseLoading) {
    return;
  }
  if (filter) {
    state.cortexBrowseFilter = { ...state.cortexBrowseFilter, ...filter };
  }
  state.cortexBrowseLoading = true;
  state.cortexBrowseError = null;
  try {
    state.cortexTriples = await state.client.request("cortex.triples", {
      subject: state.cortexBrowseFilter.subject,
      predicate: state.cortexBrowseFilter.predicate,
      limit: state.cortexBrowseFilter.limit,
      offset: state.cortexBrowseFilter.offset,
    });
  } catch (err) {
    state.cortexBrowseError = String(err);
  } finally {
    state.cortexBrowseLoading = false;
  }
}

export async function loadCortexSubjects(state: CortexState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.cortexSubjects = await state.client.request("cortex.subjects", { limit: 200 });
  } catch {
    // non-critical — subjects dropdown just won't populate
  }
}

export async function loadCortexPredicates(state: CortexState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.cortexPredicates = await state.client.request("cortex.predicates", { limit: 200 });
  } catch {
    // non-critical — predicates dropdown just won't populate
  }
}
