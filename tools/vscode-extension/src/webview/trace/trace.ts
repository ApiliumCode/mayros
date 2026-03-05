import { vscode } from "../shared/vscode-api.js";
import type { ExtensionMessage, TraceEventView } from "../shared/message-types.js";

/* ------------------------------------------------------------------ */
/*  Trace Viewer webview — event timeline                              */
/* ------------------------------------------------------------------ */

const app = document.getElementById("app")!;

app.innerHTML = `
  <div id="trace-container" style="display:flex;flex-direction:column;height:100%;">
    <div id="trace-header" style="padding:4px 0;display:flex;gap:8px;align-items:center;">
      <input id="agent-filter" type="text" placeholder="Filter by agent ID..."
        style="flex:1;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" />
      <input id="limit-input" type="number" value="100" min="1" max="1000"
        style="width:60px;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" />
      <button id="refresh-btn" style="padding:4px 12px;">Refresh</button>
    </div>
    <div id="event-count" style="font-size:0.85em;opacity:0.7;padding:2px 0;"></div>
    <div id="events" style="flex:1;overflow-y:auto;border:1px solid var(--vscode-panel-border);"></div>
    <div id="event-detail" style="height:200px;overflow-y:auto;border:1px solid var(--vscode-panel-border);margin-top:4px;padding:8px;display:none;"></div>
  </div>
`;

const agentFilter = document.getElementById("agent-filter") as HTMLInputElement;
const limitInput = document.getElementById("limit-input") as HTMLInputElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const eventCountDiv = document.getElementById("event-count")!;
const eventsDiv = document.getElementById("events")!;
const eventDetail = document.getElementById("event-detail")!;

let allEvents: TraceEventView[] = [];

/* ---- UI events ---- */

refreshBtn.addEventListener("click", () => {
  requestRefresh();
});

agentFilter.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    requestRefresh();
  }
});

function requestRefresh(): void {
  const agentId = agentFilter.value.trim() || undefined;
  const limit = parseInt(limitInput.value, 10) || 100;
  vscode.postMessage({ type: "trace.refresh", agentId, limit });
}

/* ---- Extension messages ---- */

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "trace.data":
      handleTraceData((msg as { type: "trace.data"; events: TraceEventView[] }).events);
      break;
    case "error":
      showError((msg as { type: "error"; text: string }).text);
      break;
  }
});

// Request initial data
vscode.postMessage({ type: "trace.refresh", limit: 100 });

/* ---- Renderers ---- */

function handleTraceData(events: TraceEventView[]): void {
  // Merge streaming events (append) or replace (bulk)
  if (events.length === 1 && allEvents.length > 0) {
    // Likely a streaming event — append if not duplicate
    const evt = events[0];
    if (!allEvents.some((e) => e.id === evt.id)) {
      allEvents.push(evt);
    }
  } else {
    allEvents = events;
  }
  renderEvents();
}

function renderEvents(): void {
  eventCountDiv.textContent = `${allEvents.length} event${allEvents.length === 1 ? "" : "s"}`;
  eventsDiv.innerHTML = "";

  if (allEvents.length === 0) {
    eventsDiv.innerHTML = '<div style="padding:8px;opacity:0.6;">No trace events.</div>';
    return;
  }

  // Render as a table
  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.9em;";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Time</th>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Type</th>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Agent</th>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">ID</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const evt of allEvents) {
    const tr = document.createElement("tr");
    tr.style.cssText = "cursor:pointer;";
    tr.addEventListener("mouseenter", () => {
      tr.style.background = "var(--vscode-list-hoverBackground)";
    });
    tr.addEventListener("mouseleave", () => {
      tr.style.background = "";
    });
    tr.addEventListener("click", () => {
      showEventDetail(evt);
    });

    tr.innerHTML = `
      <td style="padding:4px;">${escapeHtml(formatTime(evt.timestamp))}</td>
      <td style="padding:4px;"><code>${escapeHtml(evt.type)}</code></td>
      <td style="padding:4px;">${escapeHtml(evt.agentId)}</td>
      <td style="padding:4px;font-size:0.85em;opacity:0.7;">${escapeHtml(evt.id.slice(0, 8))}</td>
    `;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  eventsDiv.appendChild(table);
}

function showEventDetail(evt: TraceEventView): void {
  eventDetail.style.display = "block";
  eventDetail.innerHTML = `
    <div style="margin-bottom:8px;">
      <strong>Event:</strong> ${escapeHtml(evt.type)}<br>
      <strong>Agent:</strong> ${escapeHtml(evt.agentId)}<br>
      <strong>ID:</strong> ${escapeHtml(evt.id)}<br>
      <strong>Time:</strong> ${escapeHtml(evt.timestamp)}<br>
      ${evt.parentId ? `<strong>Parent:</strong> ${escapeHtml(evt.parentId)}<br>` : ""}
    </div>
    <pre style="background:var(--vscode-textBlockQuote-background);padding:8px;border-radius:4px;overflow-x:auto;font-size:0.85em;">${escapeHtml(JSON.stringify(evt.data, null, 2))}</pre>
  `;
}

function showError(text: string): void {
  eventsDiv.innerHTML = `<div style="padding:8px;color:var(--vscode-errorForeground);">${escapeHtml(text)}</div>`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
