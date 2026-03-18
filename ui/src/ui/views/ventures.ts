import { html, nothing } from "lit";
import type {
  VentureDashboardResponse,
  VentureSummary,
  MissionSummary,
} from "../controllers/ventures.ts";
import { renderChainVisualizer } from "./chain-visualizer.ts";

export type VentureDashboardProps = {
  loading: boolean;
  error: string | null;
  dashboard: VentureDashboardResponse | null;
  onRefresh: () => void;
  onNewVenture?: () => void;
};

// ============================================================================
// Helpers
// ============================================================================

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fuelPercent(spent: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((spent / limit) * 100));
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
    case "running":
    case "complete":
      return "ok";
    case "queued":
    case "ready":
    case "idle":
    case "paused":
    case "stopped":
      return "warn";
    default:
      return "";
  }
}

function priorityBadge(priority: string) {
  const lower = priority.toLowerCase();
  let cls = "";
  if (lower === "critical" || lower === "high") {
    cls = "warn";
  } else if (lower === "low") {
    cls = "muted";
  }
  return html`<span class="stat-value ${cls}" style="font-size: 0.8em;">${priority}</span>`;
}

const MISSION_STATUS_ORDER = ["queued", "ready", "active", "review", "complete"] as const;

// ============================================================================
// Cards
// ============================================================================

function renderStatsCard(stats: VentureDashboardResponse["stats"]) {
  return html`
    <section class="card">
      <h3>Stats</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 12px; text-align: center;">
        <div>
          <div class="stat-value" style="font-size: 2rem;">${stats.totalVentures}</div>
          <div class="muted">Total Ventures</div>
        </div>
        <div>
          <div class="stat-value" style="font-size: 2rem;">${stats.activeMissions}</div>
          <div class="muted">Active Missions</div>
        </div>
        <div>
          <div class="stat-value" style="font-size: 2rem;">${formatCents(stats.totalFuelSpent)}</div>
          <div class="muted">Total Fuel Spent</div>
        </div>
      </div>
    </section>
  `;
}

function renderVenturesTable(ventures: VentureSummary[]) {
  if (ventures.length === 0) {
    return html`
      <section class="card">
        <h3>Ventures</h3>
        <div class="muted" style="margin-top: 12px">No ventures created yet.</div>
      </section>
    `;
  }

  return html`
    <section class="card">
      <h3>Ventures</h3>
      <div style="overflow-x: auto; margin-top: 12px;">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Prefix</th>
              <th>Status</th>
              <th>Fuel</th>
              <th style="text-align: right;">Agents</th>
              <th style="text-align: right;">Missions</th>
            </tr>
          </thead>
          <tbody>
            ${ventures.map(
              (v) => {
                const pct = fuelPercent(v.fuelSpent, v.fuelLimit);
                const barColor = pct >= 90 ? "var(--color-warn, #e2a03f)" : "var(--color-ok, #25c281)";
                return html`
                  <tr>
                    <td><code>${v.id}</code></td>
                    <td>${v.name}</td>
                    <td><code>${v.prefix}</code></td>
                    <td>
                      <span class="stat-value ${statusClass(v.status)}" style="font-size: 0.85em;">
                        ${v.status}
                      </span>
                    </td>
                    <td>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="background: var(--bg-secondary); border-radius: 4px; height: 8px; width: 100px;">
                          <div style="background: ${barColor}; height: 100%; width: ${pct}%; border-radius: 4px;"></div>
                        </div>
                        <span class="muted" style="font-size: 0.85em; white-space: nowrap;">
                          ${formatCents(v.fuelSpent)} / ${formatCents(v.fuelLimit)}
                        </span>
                      </div>
                    </td>
                    <td style="text-align: right;">${v.agentCount}</td>
                    <td style="text-align: right;">${v.missionCount}</td>
                  </tr>
                `;
              },
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMissionColumn(status: string, missions: MissionSummary[]) {
  return html`
    <div style="flex: 1; min-width: 180px;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
        <span class="stat-value ${statusClass(status)}" style="font-size: 0.85em; text-transform: capitalize;">
          ${status}
        </span>
        <span class="muted" style="font-size: 0.8em;">(${missions.length})</span>
      </div>
      ${missions.length === 0
        ? html`<div class="muted" style="font-size: 0.85em; padding: 8px 0;">No missions</div>`
        : missions.map(
            (m) => html`
              <div
                style="
                  background: var(--bg-secondary);
                  border-radius: 6px;
                  padding: 10px 12px;
                  margin-bottom: 8px;
                "
              >
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                  <code style="font-size: 0.85em;">${m.identifier}</code>
                  ${priorityBadge(m.priority)}
                </div>
                <div style="font-size: 0.9em; margin-bottom: 4px;">${m.title}</div>
                ${m.claimedBy
                  ? html`<div class="muted" style="font-size: 0.8em;">Agent: <code>${m.claimedBy}</code></div>`
                  : html`<div class="muted" style="font-size: 0.8em;">Unclaimed</div>`}
              </div>
            `,
          )}
    </div>
  `;
}

function renderMissionBoard(missions: MissionSummary[]) {
  if (missions.length === 0) {
    return html`
      <section class="card">
        <h3>Missions</h3>
        <div class="muted" style="margin-top: 12px">No missions found.</div>
      </section>
    `;
  }

  const grouped = new Map<string, MissionSummary[]>();
  for (const status of MISSION_STATUS_ORDER) {
    grouped.set(status, []);
  }
  for (const m of missions) {
    const key = m.status.toLowerCase();
    const list = grouped.get(key);
    if (list) {
      list.push(m);
    } else {
      // Unknown status — add to its own column
      grouped.set(key, [m]);
    }
  }

  return html`
    <section class="card">
      <h3>Missions</h3>
      <div
        style="
          display: flex;
          gap: 16px;
          margin-top: 12px;
          overflow-x: auto;
          padding-bottom: 8px;
        "
      >
        ${[...grouped.entries()].map(([status, list]) => renderMissionColumn(status, list))}
      </div>
    </section>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderVenturesDashboard(props: VentureDashboardProps) {
  if (props.error) {
    return html`
      <section class="card" style="text-align: center; padding: 32px;">
        <div class="stat-value warn">Error loading Ventures dashboard</div>
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
        <div class="muted">${props.loading ? "Loading Ventures dashboard..." : "No data available"}</div>
      </section>
    `;
  }

  const d = props.dashboard;

  return html`
    <section>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <span class="muted">Ventures: ${d.ventures.length} | Missions: ${d.missions.length}</span>
        </div>
        ${props.onNewVenture
          ? html`<button
              class="btn btn--sm"
              style="background: var(--accent, #ff5c5c); color: var(--accent-foreground, #fff);"
              @click=${() => props.onNewVenture!()}
            >New Venture</button>`
          : nothing}
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
          Refresh
        </button>
      </div>

      ${renderStatsCard(d.stats)}

      ${renderVenturesTable(d.ventures)}

      ${renderMissionBoard(d.missions)}

      ${d.chain && d.chain.length > 0
        ? renderChainVisualizer({
            chain: d.chain,
            ventureId: d.ventures.length > 0 ? d.ventures[0].id : "",
          })
        : nothing}
    </section>
  `;
}
