import { vscode } from "../shared/vscode-api.js";
import type { ExtensionMessage, SessionView, PlanView } from "../shared/message-types.js";

/* ------------------------------------------------------------------ */
/*  Plan Mode webview — phase progress display                         */
/* ------------------------------------------------------------------ */

const app = document.getElementById("app")!;

app.innerHTML = `
  <div id="plan-container" style="display:flex;flex-direction:column;height:100%;">
    <div id="plan-header" style="padding:4px 0;display:flex;gap:8px;align-items:center;">
      <select id="session-select" style="flex:1;padding:4px;">
        <option value="">Select a session...</option>
      </select>
      <button id="refresh-btn" style="padding:4px 12px;">Refresh</button>
    </div>
    <div id="phase-bar" style="display:flex;gap:2px;margin:8px 0;"></div>
    <div id="plan-content" style="flex:1;overflow-y:auto;padding:8px;border:1px solid var(--vscode-panel-border);">
      <p style="opacity:0.6;">Select a session to view plan status.</p>
    </div>
  </div>
`;

const PHASES = ["idle", "explore", "assert", "approve", "execute", "done"];

const sessionSelect = document.getElementById("session-select") as HTMLSelectElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const phaseBar = document.getElementById("phase-bar")!;
const planContent = document.getElementById("plan-content")!;

let currentSessionId = "";

/* ---- UI events ---- */

sessionSelect.addEventListener("change", () => {
  currentSessionId = sessionSelect.value;
  if (currentSessionId) {
    vscode.postMessage({
      type: "plan.refresh",
      sessionId: currentSessionId,
    });
  } else {
    planContent.innerHTML = '<p style="opacity:0.6;">Select a session to view plan status.</p>';
    renderPhaseBar(null);
  }
});

refreshBtn.addEventListener("click", () => {
  if (currentSessionId) {
    vscode.postMessage({
      type: "plan.refresh",
      sessionId: currentSessionId,
    });
  }
});

/* ---- Extension messages ---- */

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "sessions":
      renderSessions((msg as { type: "sessions"; sessions: SessionView[] }).sessions);
      break;
    case "plan.data":
      renderPlan((msg as { type: "plan.data"; plan: PlanView | null }).plan);
      break;
    case "error":
      showError((msg as { type: "error"; text: string }).text);
      break;
  }
});

// Request sessions on load
vscode.postMessage({ type: "sessions" });

/* ---- Renderers ---- */

function renderSessions(sessions: SessionView[]): void {
  sessionSelect.innerHTML = '<option value="">Select a session...</option>';
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.agentId} - ${s.status}`;
    sessionSelect.appendChild(opt);
  }
}

function renderPhaseBar(plan: PlanView | null): void {
  phaseBar.innerHTML = "";
  const current = plan?.phase ?? "";
  let reached = true;

  for (const phase of PHASES) {
    const el = document.createElement("div");
    el.style.cssText = "flex:1;text-align:center;padding:4px;font-size:0.85em;border-radius:3px;";

    if (phase === current) {
      el.style.background = "var(--vscode-button-background)";
      el.style.color = "var(--vscode-button-foreground)";
      el.style.fontWeight = "bold";
    } else if (reached) {
      el.style.background = "var(--vscode-badge-background)";
      el.style.color = "var(--vscode-badge-foreground)";
    } else {
      el.style.opacity = "0.4";
    }

    el.textContent = phase;
    phaseBar.appendChild(el);

    if (phase === current) reached = false;
  }
}

function renderPlan(plan: PlanView | null): void {
  renderPhaseBar(plan);

  if (!plan) {
    planContent.innerHTML = '<p style="opacity:0.6;">No active plan for this session.</p>';
    return;
  }

  let html = `<div style="margin-bottom:12px;">
    <strong>Plan ID:</strong> ${escapeHtml(plan.id)}<br>
    <strong>Phase:</strong> ${escapeHtml(plan.phase)}<br>
    <strong>Created:</strong> ${escapeHtml(plan.createdAt)}
  </div>`;

  // Discoveries
  html += `<h3 style="margin:8px 0 4px;">Discoveries (${plan.discoveries.length})</h3>`;
  if (plan.discoveries.length === 0) {
    html += '<p style="opacity:0.6;">No discoveries yet.</p>';
  } else {
    html += "<ul>";
    for (const d of plan.discoveries) {
      html += `<li>${escapeHtml(d.text)} <span style="opacity:0.6;font-size:0.85em;">(${escapeHtml(d.source)})</span></li>`;
    }
    html += "</ul>";
  }

  // Assertions
  html += `<h3 style="margin:8px 0 4px;">Assertions (${plan.assertions.length})</h3>`;
  if (plan.assertions.length === 0) {
    html += '<p style="opacity:0.6;">No assertions yet.</p>';
  } else {
    html += "<table style='width:100%;border-collapse:collapse;'>";
    html +=
      "<tr><th style='text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);'>Subject</th><th style='text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);'>Predicate</th><th style='text-align:center;padding:4px;border-bottom:1px solid var(--vscode-panel-border);'>Verified</th></tr>";
    for (const a of plan.assertions) {
      const icon = a.verified ? "&#10003;" : "&#10007;";
      const color = a.verified
        ? "var(--vscode-terminal-ansiGreen)"
        : "var(--vscode-terminal-ansiRed)";
      html += `<tr>
        <td style="padding:4px;">${escapeHtml(a.subject)}</td>
        <td style="padding:4px;">${escapeHtml(a.predicate)}</td>
        <td style="padding:4px;text-align:center;color:${color};">${icon}</td>
      </tr>`;
    }
    html += "</table>";
  }

  planContent.innerHTML = html;
}

function showError(text: string): void {
  planContent.innerHTML = `<div style="color:var(--vscode-errorForeground);">${escapeHtml(text)}</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
