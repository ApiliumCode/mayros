import { html, nothing } from "lit";
import type { McpDashboardResponse, ToolMetrics, ToolCallRecord } from "../controllers/mcp.ts";

export type McpDashboardProps = {
  loading: boolean;
  error: string | null;
  dashboard: McpDashboardResponse | null;
  onRefresh: () => void;
};

// ============================================================================
// Helpers
// ============================================================================

function formatUptime(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function successRate(tool: ToolMetrics): string {
  if (tool.callCount === 0) return "n/a";
  const rate = ((tool.callCount - tool.errorCount) / tool.callCount) * 100;
  return `${rate.toFixed(0)}%`;
}

function avgDuration(tool: ToolMetrics): string {
  if (tool.callCount === 0) return "n/a";
  return formatDuration(tool.totalDurationMs / tool.callCount);
}

// ============================================================================
// Cards
// ============================================================================

function renderStatusCard(dashboard: McpDashboardResponse) {
  const s = dashboard.status;
  const statusClass = s.running ? "ok" : "warn";
  const statusLabel = s.running ? "Running" : "Stopped";
  return html`
    <section class="card">
      <h3>Server Status</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 12px;">
        <div class="muted">Status</div>
        <div class="stat-value ${statusClass}">${statusLabel}</div>
        <div class="muted">Transport</div>
        <div>${s.transport}</div>
        ${
          s.address
            ? html`
          <div class="muted">Address</div>
          <div><code>${s.address}</code></div>
        `
            : nothing
        }
        <div class="muted">Tools</div>
        <div>${s.toolCount}</div>
        <div class="muted">Uptime</div>
        <div>${formatUptime(s.uptimeMs)}</div>
      </div>
    </section>
  `;
}

function renderToolUsageCard(tools: ToolMetrics[]) {
  if (tools.length === 0) {
    return html`
      <section class="card">
        <h3>Tool Usage</h3>
        <div class="muted" style="margin-top: 12px">No tool calls recorded yet.</div>
      </section>
    `;
  }

  const sorted = [...tools].sort((a, b) => b.callCount - a.callCount);
  return html`
    <section class="card">
      <h3>Tool Usage</h3>
      <div style="overflow-x: auto; margin-top: 12px;">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Tool</th>
              <th style="text-align: right;">Calls</th>
              <th style="text-align: right;">Errors</th>
              <th style="text-align: right;">Avg Duration</th>
              <th style="text-align: right;">Success Rate</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(
              (tool) => html`
                <tr>
                  <td><code>${tool.toolName}</code></td>
                  <td style="text-align: right;">${tool.callCount}</td>
                  <td style="text-align: right; ${tool.errorCount > 0 ? "color: var(--c-error, #ef4444);" : ""}">${tool.errorCount}</td>
                  <td style="text-align: right;">${avgDuration(tool)}</td>
                  <td style="text-align: right;">${successRate(tool)}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSessionsCard(dashboard: McpDashboardResponse) {
  const count = dashboard.status.sseSessionCount;
  return html`
    <section class="card">
      <h3>Active Sessions</h3>
      <div style="margin-top: 12px;">
        <div class="stat-value" style="font-size: 2rem;">${count}</div>
        <div class="muted">SSE connections</div>
      </div>
    </section>
  `;
}

function renderRecentCallsCard(calls: ToolCallRecord[]) {
  if (calls.length === 0) {
    return html`
      <section class="card">
        <h3>Recent Calls</h3>
        <div class="muted" style="margin-top: 12px">No tool calls recorded yet.</div>
      </section>
    `;
  }

  const displayed = calls.slice(0, 50);
  return html`
    <section class="card">
      <h3>Recent Calls <span class="muted" style="font-weight: normal; font-size: 0.85em;">(last ${displayed.length})</span></h3>
      <div style="overflow-x: auto; margin-top: 12px; max-height: 400px; overflow-y: auto;">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tool</th>
              <th style="text-align: right;">Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${displayed.map(
              (call) => html`
                <tr>
                  <td class="muted">${formatTimestamp(call.timestamp)}</td>
                  <td><code>${call.toolName}</code></td>
                  <td style="text-align: right;">${formatDuration(call.durationMs)}</td>
                  <td>
                    <span class="stat-value ${call.status === "ok" ? "ok" : "warn"}" style="font-size: 0.85em;">
                      ${call.status === "ok" ? "OK" : "Error"}
                    </span>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCortexHealthCard(health: McpDashboardResponse["cortexHealth"]) {
  if (!health) {
    return html`
      <section class="card">
        <h3>Cortex Health</h3>
        <div class="stat-value warn" style="margin-top: 12px">Unknown</div>
        <div class="muted">Health check not available</div>
      </section>
    `;
  }
  const statusClass = health.status === "online" ? "ok" : "warn";
  const statusLabel = health.status === "online" ? "Online" : "Offline";
  return html`
    <section class="card">
      <h3>Cortex Health</h3>
      <div style="margin-top: 12px;">
        <div class="stat-value ${statusClass}">${statusLabel}</div>
        ${
          health.status === "online"
            ? html`<div class="muted" style="margin-top: 4px;">Latency: ${formatDuration(health.latencyMs)}</div>`
            : html`
                <div class="muted" style="margin-top: 4px">AIngle Cortex sidecar not reachable</div>
              `
        }
      </div>
    </section>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderMcpDashboard(props: McpDashboardProps) {
  if (props.error) {
    return html`
      <section class="card" style="text-align: center; padding: 32px;">
        <div class="stat-value warn">Error loading MCP dashboard</div>
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
        <div class="muted">${props.loading ? "Loading MCP dashboard..." : "No data available"}</div>
      </section>
    `;
  }

  const d = props.dashboard;
  const metrics = d.metrics;

  return html`
    <section>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          ${
            metrics
              ? html`<span class="muted">Total calls: ${metrics.totalCalls} | Errors: ${metrics.totalErrors}</span>`
              : nothing
          }
        </div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
          Refresh
        </button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        ${renderStatusCard(d)}
        ${renderSessionsCard(d)}
        ${renderCortexHealthCard(d.cortexHealth)}
      </div>

      ${metrics ? renderToolUsageCard(metrics.tools) : nothing}
      ${metrics ? renderRecentCallsCard(metrics.recentCalls) : nothing}
    </section>
  `;
}
