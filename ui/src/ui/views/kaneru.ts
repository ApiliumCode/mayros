import { html, nothing } from "lit";
import type {
  KaneruDashboardResponse,
  SquadSummary,
  RouteTableEntry,
} from "../controllers/kaneru.ts";

export type KaneruDashboardProps = {
  loading: boolean;
  error: string | null;
  dashboard: KaneruDashboardResponse | null;
  onRefresh: () => void;
};

// ============================================================================
// Helpers
// ============================================================================

function formatQValue(q: number): string {
  return q.toFixed(3);
}

function formatEpsilon(epsilon: number): string {
  return `${(epsilon * 100).toFixed(1)}%`;
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
    case "running":
      return "ok";
    case "idle":
    case "paused":
    case "stopped":
      return "warn";
    default:
      return "";
  }
}

// ============================================================================
// Cards
// ============================================================================

function renderSquadsCard(squads: SquadSummary[]) {
  if (squads.length === 0) {
    return html`
      <section class="card">
        <h3>Active Squads</h3>
        <div class="muted" style="margin-top: 12px">No squads created yet.</div>
      </section>
    `;
  }

  return html`
    <section class="card">
      <h3>Active Squads</h3>
      <div style="overflow-x: auto; margin-top: 12px;">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th style="text-align: right;">Members</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${squads.map(
              (squad) => html`
                <tr>
                  <td><code>${squad.id}</code></td>
                  <td>${squad.name}</td>
                  <td>
                    <span class="stat-value ${statusClass(squad.status)}" style="font-size: 0.85em;">
                      ${squad.status}
                    </span>
                  </td>
                  <td style="text-align: right;">${squad.memberCount}</td>
                  <td class="muted">${squad.updatedAt}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRouteTableCard(
  routeTable: RouteTableEntry[],
  stats: KaneruDashboardResponse["stats"],
) {
  if (routeTable.length === 0) {
    return html`
      <section class="card">
        <h3>Mission Router</h3>
        <div class="muted" style="margin-top: 12px;">Q-learning table is empty. Route missions to train it.</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 16px;">
          <div class="muted">Q-Table Size</div>
          <div>${stats.qTableSize}</div>
          <div class="muted">Epsilon</div>
          <div>${formatEpsilon(stats.epsilon)}</div>
        </div>
      </section>
    `;
  }

  const sorted = [...routeTable].sort((a, b) => b.qValue - a.qValue);
  const displayed = sorted.slice(0, 20);

  return html`
    <section class="card">
      <h3>Mission Router <span class="muted" style="font-weight: normal; font-size: 0.85em;">(top ${displayed.length} by Q-value)</span></h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 12px; margin-bottom: 16px;">
        <div class="muted">Q-Table Size</div>
        <div>${stats.qTableSize}</div>
        <div class="muted">Epsilon</div>
        <div>${formatEpsilon(stats.epsilon)}</div>
      </div>
      <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>State Key</th>
              <th>Agent</th>
              <th style="text-align: right;">Q-Value</th>
            </tr>
          </thead>
          <tbody>
            ${displayed.map(
              (entry) => html`
                <tr>
                  <td><code>${entry.stateKey}</code></td>
                  <td><code>${entry.agentId}</code></td>
                  <td style="text-align: right;">${formatQValue(entry.qValue)}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStatsCard(stats: KaneruDashboardResponse["stats"]) {
  return html`
    <section class="card">
      <h3>Stats</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 12px; text-align: center;">
        <div>
          <div class="stat-value" style="font-size: 2rem;">${stats.activeSquads}</div>
          <div class="muted">Active Squads</div>
        </div>
        <div>
          <div class="stat-value" style="font-size: 2rem;">${stats.qTableSize}</div>
          <div class="muted">Q-Table Size</div>
        </div>
        <div>
          <div class="stat-value" style="font-size: 2rem;">${formatEpsilon(stats.epsilon)}</div>
          <div class="muted">Epsilon</div>
        </div>
      </div>
    </section>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderKaneruDashboard(props: KaneruDashboardProps) {
  if (props.error) {
    return html`
      <section class="card" style="text-align: center; padding: 32px;">
        <div class="stat-value warn">Error loading Kaneru dashboard</div>
        <div class="muted" style="margin: 12px 0;">${props.error}</div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
          Retry
        </button>
      </section>
    `;
  }

  if (!props.dashboard) {
    return html`
      <section class="card" style="text-align: center; padding: 32px;">
        <div class="muted">${props.loading ? "Loading Kaneru dashboard..." : "No data available"}</div>
      </section>
    `;
  }

  const d = props.dashboard;

  return html`
    <section>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <span class="muted">Squads: ${d.squads.length} | Q-Table: ${d.stats.qTableSize} entries</span>
        </div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
          Refresh
        </button>
      </div>

      ${renderStatsCard(d.stats)}

      ${renderSquadsCard(d.squads)}

      ${renderRouteTableCard(d.routeTable, d.stats)}
    </section>
  `;
}
