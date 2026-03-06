import type * as vscode from "vscode";
import type { MayrosClient } from "../mayros-client.js";

const explainSessionKey = `vscode-explain-${Date.now().toString(36)}`;
const actionsSessionKey = `vscode-actions-${Date.now().toString(36)}`;

/**
 * Ask Mayros to explain the currently selected code.
 * Sends the selection with file context to the gateway.
 */
export async function explainCode(client: MayrosClient): Promise<void> {
  const editor = await getActiveEditor();
  if (!editor) return;

  const { text, fileName, language } = getSelectionContext(editor);
  if (!text) return;

  const langSuffix = language ? ` (${language})` : "";
  const message =
    `Explain the following code from \`${fileName}\`${langSuffix}:\n\n` +
    `\`\`\`${language}\n${text}\n\`\`\`\n\n` +
    `Please explain what this code does, its purpose, and any notable patterns or concerns.`;

  client.sendMessage(explainSessionKey, message).catch((e) => {
    console.error("[Mayros] Failed to send explain request:", e);
  });
}

/**
 * Send the currently selected code to Mayros chat.
 */
export async function sendSelection(client: MayrosClient): Promise<void> {
  const editor = await getActiveEditor();
  if (!editor) return;

  const { text, fileName, language } = getSelectionContext(editor);
  if (!text) return;

  const langSuffix = language ? ` (${language})` : "";
  const message =
    `Here is code from \`${fileName}\`${langSuffix}:\n\n` + `\`\`\`${language}\n${text}\n\`\`\``;

  client.sendMessage(actionsSessionKey, message).catch((e) => {
    console.error("[Mayros] Failed to send selection:", e);
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getActiveEditor(): Promise<vscode.TextEditor | undefined> {
  // Dynamic import to keep module testable without vscode at load time
  const vsc = await import("vscode");
  return vsc.window.activeTextEditor;
}

function getSelectionContext(editor: vscode.TextEditor): {
  text: string;
  fileName: string;
  language: string;
} {
  const selection = editor.selection;
  const text = editor.document.getText(selection);
  const fileName = editor.document.fileName.split(/[\\/]/).pop() ?? "unknown";
  const language = editor.document.languageId ?? "";
  return { text, fileName, language };
}
