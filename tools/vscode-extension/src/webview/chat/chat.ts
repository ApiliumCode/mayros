import { vscode } from "../shared/vscode-api.js";
import type {
  ExtensionMessage,
  SessionView,
  ChatMessageView,
  ChatAttachmentView,
} from "../shared/message-types.js";
import cssText from "./chat.css";

/* ------------------------------------------------------------------ */
/*  Chat webview — Mayros VSCode extension                             */
/* ------------------------------------------------------------------ */

/* ---- Inject stylesheet ---- */

const style = document.createElement("style");
style.textContent = cssText;
document.head.appendChild(style);

/* ---- Pending attachments ---- */

type PendingAttachment = ChatAttachmentView;
const pendingAttachments: PendingAttachment[] = [];

/* ---- Build DOM ---- */

const app = document.getElementById("app")!;

const header = el("div", "chat-header");
const dot = el("span", "chat-header__dot chat-header__dot--disconnected");
const titleSpan = el("span", "chat-header__title");
titleSpan.textContent = "Mayros Chat";
const statusSpan = el("span", "chat-header__status");
statusSpan.textContent = "Disconnected";
header.append(dot, titleSpan, statusSpan);

const selectorWrapper = el("div", "session-selector");
const sessionSelect = document.createElement("select");
sessionSelect.innerHTML = '<option value="">Select a session\u2026</option>';
selectorWrapper.appendChild(sessionSelect);

const messagesDiv = el("div", "messages");

const inputArea = el("div", "input-area");
const inputBox = el("div", "input-area__box");

const textarea = document.createElement("textarea");
textarea.rows = 2;
textarea.placeholder = "Type a message\u2026";

const previewStrip = el("div", "attachment-preview");

const toolbar = el("div", "input-area__toolbar");

const attachBtn = document.createElement("button");
attachBtn.className = "input-area__btn input-area__btn--icon";
attachBtn.title = "Attach image";
attachBtn.textContent = "\uD83D\uDCCE"; // 📎

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*";
fileInput.multiple = true;
fileInput.style.display = "none";

const spacer = el("div", "input-area__toolbar-spacer");

const abortBtn = document.createElement("button");
abortBtn.className = "input-area__btn input-area__btn--secondary";
abortBtn.textContent = "Abort";

const divider = el("div", "input-area__divider");

const sendBtn = document.createElement("button");
sendBtn.className = "input-area__btn input-area__btn--primary";
sendBtn.textContent = "Send";

toolbar.append(attachBtn, fileInput, spacer, abortBtn, divider, sendBtn);
inputBox.append(textarea, previewStrip, toolbar);
inputArea.append(inputBox);

const container = el("div", "chat-container");
container.append(header, selectorWrapper, messagesDiv, inputArea);
app.appendChild(container);

/* ---- State ---- */

let currentSessionId = "";

/** Map of runId → live streaming message element for progressive updates. */
const streamingMessages = new Map<string, HTMLElement>();

/* ---- UI event handlers ---- */

sessionSelect.addEventListener("change", () => {
  currentSessionId = sessionSelect.value;
  if (currentSessionId) {
    vscode.postMessage({ type: "history", sessionId: currentSessionId });
  } else {
    messagesDiv.innerHTML = "";
  }
});

sendBtn.addEventListener("click", () => sendCurrentMessage());

textarea.addEventListener("keydown", (e) => {
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

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (!files) return;
  for (let i = 0; i < files.length; i++) {
    readFileAsAttachment(files[i]);
  }
  fileInput.value = "";
});

/* ---- Attachment helpers ---- */

function readFileAsAttachment(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    // result is data:<mime>;base64,<data>
    const commaIdx = result.indexOf(",");
    const dataBase64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
    const attachment: PendingAttachment = {
      name: file.name,
      mimeType: file.type || "image/png",
      dataBase64,
    };
    pendingAttachments.push(attachment);
    renderPreviewStrip();
  };
  reader.readAsDataURL(file);
}

function renderPreviewStrip(): void {
  previewStrip.innerHTML = "";
  for (let i = 0; i < pendingAttachments.length; i++) {
    const att = pendingAttachments[i];
    const item = el("div", "attachment-preview__item");

    const thumb = document.createElement("img");
    thumb.className = "attachment-preview__thumb";
    thumb.src = `data:${att.mimeType};base64,${att.dataBase64}`;
    thumb.alt = att.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "attachment-preview__remove";
    removeBtn.textContent = "\u00D7"; // ×
    removeBtn.title = `Remove ${att.name}`;
    const idx = i;
    removeBtn.addEventListener("click", () => {
      pendingAttachments.splice(idx, 1);
      renderPreviewStrip();
    });

    item.append(thumb, removeBtn);
    previewStrip.appendChild(item);
  }
}

/* ---- Send ---- */

function sendCurrentMessage(): void {
  const content = textarea.value.trim();
  if (!content || !currentSessionId) return;

  const attachments =
    pendingAttachments.length > 0
      ? pendingAttachments.splice(0, pendingAttachments.length)
      : undefined;

  vscode.postMessage({
    type: "send",
    sessionId: currentSessionId,
    content,
    ...(attachments ? { attachments } : {}),
  });

  appendMessage({
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    attachments,
  });

  textarea.value = "";
  renderPreviewStrip();
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
    case "stream":
      handleStream(msg.runId, msg.state, msg.content);
      break;
    case "error":
      showError(msg.text);
      break;
    case "connectionStatus":
      updateConnectionStatus(msg.connected);
      break;
  }
});

// Request sessions on load
vscode.postMessage({ type: "sessions" });

/* ---- Streaming ---- */

function handleStream(
  runId: string,
  state: "delta" | "final" | "aborted" | "error",
  content: string,
): void {
  if (state === "delta") {
    let bubble = streamingMessages.get(runId);
    if (!bubble) {
      // Create a new streaming message bubble
      bubble = el("div", "message message--assistant message--streaming");
      const headerRow = el("div", "message__header");
      const roleLabel = el("span", "message__role");
      roleLabel.textContent = "assistant";
      const timestamp = el("span", "message__timestamp");
      timestamp.textContent = formatTime(new Date().toISOString());
      headerRow.append(roleLabel, timestamp);
      const contentEl = el("div", "message__content");
      contentEl.textContent = content;
      bubble.append(headerRow, contentEl);
      messagesDiv.appendChild(bubble);
      streamingMessages.set(runId, bubble);
    } else {
      // Update existing bubble with latest content
      const contentEl = bubble.querySelector(".message__content");
      if (contentEl) {
        contentEl.textContent = content;
      }
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } else if (state === "final") {
    const bubble = streamingMessages.get(runId);
    if (bubble) {
      bubble.classList.remove("message--streaming");
      const contentEl = bubble.querySelector(".message__content");
      if (contentEl && content) {
        contentEl.textContent = content;
      }
      streamingMessages.delete(runId);
    } else if (content) {
      // No delta was shown — append as regular message
      appendMessage({ role: "assistant", content, timestamp: new Date().toISOString() });
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } else if (state === "error") {
    streamingMessages.delete(runId);
    showError(content);
  } else if (state === "aborted") {
    const bubble = streamingMessages.get(runId);
    if (bubble) {
      bubble.classList.remove("message--streaming");
      bubble.classList.add("message--aborted");
      const contentEl = bubble.querySelector(".message__content");
      if (contentEl) {
        contentEl.textContent += " [aborted]";
      }
      streamingMessages.delete(runId);
    }
  }
}

/* ---- Renderers ---- */

function renderSessions(sessions: SessionView[]): void {
  sessionSelect.innerHTML = '<option value="">Select a session\u2026</option>';
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.agentId} \u2013 ${s.status} (${s.messageCount} msgs)`;
    sessionSelect.appendChild(opt);
  }
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
  const div = el("div", `message message--${message.role}`);

  const headerRow = el("div", "message__header");
  const roleLabel = el("span", "message__role");
  roleLabel.textContent = message.role;
  const timestamp = el("span", "message__timestamp");
  timestamp.textContent = formatTime(message.timestamp);
  headerRow.append(roleLabel, timestamp);

  const content = el("div", "message__content");
  content.textContent = message.content;

  div.append(headerRow, content);

  if (message.attachments && message.attachments.length > 0) {
    const attDiv = el("div", "message__attachments");
    for (const att of message.attachments) {
      const img = document.createElement("img");
      img.className = "message__attachment-img";
      img.src = `data:${att.mimeType};base64,${att.dataBase64}`;
      img.alt = att.name;
      img.title = att.name;
      attDiv.appendChild(img);
    }
    div.appendChild(attDiv);
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    const tools = el("div", "message__tools");
    tools.textContent = `Tools: ${message.toolCalls.map((t) => t.name).join(", ")}`;
    div.appendChild(tools);
  }

  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showError(text: string): void {
  const div = el("div", "error-message");
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateConnectionStatus(connected: boolean): void {
  dot.className = connected
    ? "chat-header__dot chat-header__dot--connected"
    : "chat-header__dot chat-header__dot--disconnected";
  statusSpan.textContent = connected ? "Connected" : "Disconnected";
}

/* ---- Helpers ---- */

function el(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement;
  node.className = className;
  return node;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
