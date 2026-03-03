import { vscode } from "../shared/vscode-api.js";
import type { ExtensionMessage, SessionView, ChatMessageView } from "../shared/message-types.js";

/* ------------------------------------------------------------------ */
/*  Chat webview — vanilla TypeScript                                  */
/* ------------------------------------------------------------------ */

const app = document.getElementById("app")!;

app.innerHTML = `
  <div id="chat-container" style="display:flex;flex-direction:column;height:100%;">
    <div id="session-selector" style="padding:4px 0;">
      <select id="session-select" style="width:100%;padding:4px;">
        <option value="">Select a session...</option>
      </select>
    </div>
    <div id="messages" style="flex:1;overflow-y:auto;padding:8px;border:1px solid var(--vscode-panel-border);margin:4px 0;"></div>
    <div id="input-area" style="display:flex;gap:4px;">
      <textarea id="input" placeholder="Type a message..." rows="3"
        style="flex:1;resize:none;padding:4px;font-family:inherit;font-size:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
      </textarea>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <button id="send-btn" style="padding:4px 12px;">Send</button>
        <button id="abort-btn" style="padding:4px 12px;">Abort</button>
      </div>
    </div>
  </div>
`;

const sessionSelect = document.getElementById("session-select") as HTMLSelectElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const abortBtn = document.getElementById("abort-btn") as HTMLButtonElement;
const messagesDiv = document.getElementById("messages")!;

let currentSessionId = "";

/* ---- UI events ---- */

sessionSelect.addEventListener("change", () => {
  currentSessionId = sessionSelect.value;
  if (currentSessionId) {
    vscode.postMessage({ type: "history", sessionId: currentSessionId });
  } else {
    messagesDiv.innerHTML = "";
  }
});

sendBtn.addEventListener("click", () => {
  sendCurrentMessage();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendCurrentMessage();
  }
});

abortBtn.addEventListener("click", () => {
  if (currentSessionId) {
    vscode.postMessage({ type: "abort", sessionId: currentSessionId });
  }
});

function sendCurrentMessage(): void {
  const content = input.value.trim();
  if (!content || !currentSessionId) return;
  vscode.postMessage({
    type: "send",
    sessionId: currentSessionId,
    content,
  });
  appendMessage({
    role: "user",
    content,
    timestamp: new Date().toISOString(),
  });
  input.value = "";
}

/* ---- Extension messages ---- */

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "sessions":
      renderSessions(msg.sessions);
      break;
    case "history":
      renderHistory(msg.messages);
      break;
    case "message":
      appendMessage(msg.message);
      break;
    case "error":
      showError(msg.text);
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
    opt.textContent = `${s.agentId} - ${s.status} (${s.messageCount} msgs)`;
    sessionSelect.appendChild(opt);
  }
  // Restore selection if the previous session still exists
  if (currentSessionId) {
    const exists = sessions.some((s) => s.id === currentSessionId);
    if (exists) {
      sessionSelect.value = currentSessionId;
    } else {
      currentSessionId = "";
    }
  }
}

function renderHistory(messages: ChatMessageView[]): void {
  messagesDiv.innerHTML = "";
  for (const m of messages) {
    appendMessage(m);
  }
}

function appendMessage(message: ChatMessageView): void {
  const div = document.createElement("div");
  div.style.cssText = "margin-bottom:8px;padding:6px;border-radius:4px;";

  const roleColor =
    message.role === "user"
      ? "var(--vscode-terminal-ansiBlue)"
      : message.role === "assistant"
        ? "var(--vscode-terminal-ansiGreen)"
        : "var(--vscode-terminal-ansiYellow)";

  const roleLabel = document.createElement("strong");
  roleLabel.style.color = roleColor;
  roleLabel.textContent = message.role;

  const timestamp = document.createElement("span");
  timestamp.style.cssText = "font-size:0.85em;margin-left:8px;opacity:0.7;";
  timestamp.textContent = formatTime(message.timestamp);

  const content = document.createElement("div");
  content.style.cssText = "margin-top:4px;white-space:pre-wrap;";
  content.textContent = message.content;

  div.appendChild(roleLabel);
  div.appendChild(timestamp);
  div.appendChild(content);

  if (message.toolCalls && message.toolCalls.length > 0) {
    const tools = document.createElement("div");
    tools.style.cssText = "margin-top:4px;font-size:0.85em;opacity:0.7;";
    tools.textContent = `Tools: ${message.toolCalls.map((t) => t.name).join(", ")}`;
    div.appendChild(tools);
  }

  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showError(text: string): void {
  const div = document.createElement("div");
  div.style.cssText =
    "margin-bottom:8px;padding:6px;color:var(--vscode-errorForeground);background:var(--vscode-inputValidation-errorBackground);border-radius:4px;";
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
