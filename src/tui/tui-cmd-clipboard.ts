/**
 * Clipboard/export command group.
 * Commands: copy, export
 */

import { writeFileSync } from "node:fs";
import { copyToClipboard } from "../infra/clipboard.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const clipboardCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const { chatLog } = ctx;

  switch (name) {
    case "copy": {
      const lastText = chatLog.getLastAssistantText();
      if (!lastText) {
        chatLog.addSystem("nothing to copy");
        return true;
      }
      try {
        const ok = await copyToClipboard(lastText);
        chatLog.addSystem(
          ok ? "last response copied to clipboard" : "copy failed: no clipboard tool found",
        );
      } catch (err) {
        chatLog.addSystem(`copy failed: ${String(err)}`);
      }
      return true;
    }
    case "export": {
      const lastText = chatLog.getLastAssistantText();
      if (!lastText) {
        chatLog.addSystem("nothing to export");
        return true;
      }
      const filePath = args || `mayros-export-${Date.now()}.md`;
      try {
        writeFileSync(filePath, lastText, "utf-8");
        chatLog.addSystem(`exported to ${filePath}`);
      } catch (err) {
        chatLog.addSystem(`export failed: ${String(err)}`);
      }
      return true;
    }
    default:
      return false;
  }
};
