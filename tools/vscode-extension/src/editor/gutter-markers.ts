import * as vscode from "vscode";
import type { MayrosClient } from "../mayros-client.js";

const MARKER_PATTERN = /(?:\/\/|#)\s*(TODO|FIXME|HACK|mayros:)\s*(.+)/gi;
const BLOCK_MARKER_PATTERN = /\/\*[\s\S]*?(TODO|FIXME|HACK|mayros:)\s*(.+?)(?:\*\/|$)/gi;

/**
 * CodeLens provider that adds "Analyze with Mayros" lenses
 * next to TODO/FIXME/HACK/mayros: comments.
 */
export class MayrosCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    const addLens = (match: RegExpExecArray, tag: string, comment: string): void => {
      const pos = document.positionAt(match.index);
      const range = new vscode.Range(pos, pos);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(info) Mayros: Analyze ${tag}`,
          command: "mayros.sendMarker",
          arguments: [document.fileName, pos.line + 1, `${tag} ${comment}`.trim()],
        }),
      );
    };

    // Single-line comments: // TODO ..., # FIXME ..., // mayros: ...
    MARKER_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_PATTERN.exec(text)) !== null) {
      addLens(m, m[1], m[2]);
    }

    // Block comments: /* TODO ... */
    BLOCK_MARKER_PATTERN.lastIndex = 0;
    while ((m = BLOCK_MARKER_PATTERN.exec(text)) !== null) {
      addLens(m, m[1], m[2]);
    }

    return lenses;
  }
}

/**
 * Send a marker comment to Mayros for analysis.
 */
export function sendMarker(client: MayrosClient, file: string, line: number, text: string): void {
  const fileName = file.split(/[\\/]/).pop() ?? "unknown";
  const sessionKey = `vscode-markers-${fileName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

  const message =
    `Found a marker comment in \`${fileName}\` at line ${line}:\n\n` +
    `\`\`\`\n${text}\n\`\`\`\n\n` +
    `Please analyze this and suggest a resolution or improvement.`;

  client.sendMessage(sessionKey, message).catch(() => {});
}
