import { vscode } from "../shared/vscode-api.js";
import type { ExtensionMessage, KgEntryView } from "../shared/message-types.js";

/* ------------------------------------------------------------------ */
/*  Knowledge Graph webview — triple browser and search                */
/* ------------------------------------------------------------------ */

const app = document.getElementById("app")!;

app.innerHTML = `
  <div id="kg-container" style="display:flex;flex-direction:column;height:100%;">
    <div id="kg-header" style="padding:4px 0;display:flex;gap:8px;align-items:center;">
      <input id="search-input" type="text" placeholder="Search knowledge graph..."
        style="flex:1;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" />
      <input id="limit-input" type="number" value="50" min="1" max="500"
        style="width:60px;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" />
      <button id="search-btn" style="padding:4px 12px;">Search</button>
    </div>
    <div id="result-count" style="font-size:0.85em;opacity:0.7;padding:2px 0;"></div>
    <div id="results" style="flex:1;overflow-y:auto;border:1px solid var(--vscode-panel-border);"></div>
  </div>
`;

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const limitInput = document.getElementById("limit-input") as HTMLInputElement;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const resultCount = document.getElementById("result-count")!;
const resultsDiv = document.getElementById("results")!;

/* ---- UI events ---- */

searchBtn.addEventListener("click", () => {
  performSearch();
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    performSearch();
  }
});

function performSearch(): void {
  const query = searchInput.value.trim();
  if (!query) return;
  const limit = parseInt(limitInput.value, 10) || 50;
  vscode.postMessage({ type: "kg.search", query, limit });
}

/* ---- Extension messages ---- */

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "kg.results":
      renderResults((msg as { type: "kg.results"; entries: KgEntryView[] }).entries);
      break;
    case "error":
      showError((msg as { type: "error"; text: string }).text);
      break;
  }
});

/* ---- Renderers ---- */

function renderResults(entries: KgEntryView[]): void {
  resultCount.textContent = `${entries.length} triple${entries.length === 1 ? "" : "s"}`;
  resultsDiv.innerHTML = "";

  if (entries.length === 0) {
    resultsDiv.innerHTML = '<div style="padding:8px;opacity:0.6;">No results found.</div>';
    return;
  }

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.9em;";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Subject</th>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Predicate</th>
    <th style="text-align:left;padding:4px;border-bottom:1px solid var(--vscode-panel-border);">Object</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const entry of entries) {
    const tr = document.createElement("tr");
    tr.style.cssText = "cursor:pointer;";
    tr.addEventListener("mouseenter", () => {
      tr.style.background = "var(--vscode-list-hoverBackground)";
    });
    tr.addEventListener("mouseleave", () => {
      tr.style.background = "";
    });

    const subjectTd = document.createElement("td");
    subjectTd.style.cssText = "padding:4px;";
    const subjectLink = document.createElement("a");
    subjectLink.href = "#";
    subjectLink.textContent = entry.subject;
    subjectLink.style.cssText = "color:var(--vscode-textLink-foreground);text-decoration:none;";
    subjectLink.addEventListener("click", (e) => {
      e.preventDefault();
      exploreSubject(entry.subject);
    });
    subjectTd.appendChild(subjectLink);

    const predTd = document.createElement("td");
    predTd.style.cssText = "padding:4px;";
    predTd.innerHTML = `<code>${escapeHtml(entry.predicate)}</code>`;

    const objTd = document.createElement("td");
    objTd.style.cssText = "padding:4px;";
    const objLink = document.createElement("a");
    objLink.href = "#";
    objLink.textContent = entry.object;
    objLink.style.cssText = "color:var(--vscode-textLink-foreground);text-decoration:none;";
    objLink.addEventListener("click", (e) => {
      e.preventDefault();
      exploreSubject(entry.object);
    });
    objTd.appendChild(objLink);

    tr.appendChild(subjectTd);
    tr.appendChild(predTd);
    tr.appendChild(objTd);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  resultsDiv.appendChild(table);
}

function exploreSubject(subject: string): void {
  searchInput.value = subject;
  vscode.postMessage({ type: "kg.explore", subject });
}

function showError(text: string): void {
  resultsDiv.innerHTML = `<div style="padding:8px;color:var(--vscode-errorForeground);">${escapeHtml(text)}</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
