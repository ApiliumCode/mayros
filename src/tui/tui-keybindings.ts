/**
 * Editor key binding wiring extracted from tui.ts.
 *
 * Wires the CustomEditor's onSubmit/onEscape/onCtrl-X/onShiftTab callbacks
 * to their handlers. Mutable TUI state is accessed via the shared
 * TuiStateAccess object so changes propagate to the rest of runTui.
 */

import type { ChatLog } from "./components/chat-log.js";
import type { CustomEditor } from "./components/custom-editor.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import type { MouseHandler } from "./mouse-handler.js";
import { nextSectionState, type SectionState, type TuiStateAccess } from "./tui-types.js";
import type { TUI } from "@earendil-works/pi-tui";

export interface EditorKeyBindingDeps {
  editor: CustomEditor;
  tui: TUI;
  chatLog: ChatLog;
  client: GatewayChatClient;
  state: TuiStateAccess;
  mouseHandler: MouseHandler;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  loadHistory: () => Promise<void>;
  openModelSelector: () => Promise<void>;
  openAgentSelector: () => Promise<void>;
  openSessionSelector: () => Promise<void>;
}

/**
 * Wires all editor key callbacks. The onSubmit handler must be set by the
 * caller before calling this (it depends on the submit coalescer), so this
 * function only wires onEscape and the Ctrl-X/ShiftTab bindings.
 */
export function wireEditorKeyBindings(deps: EditorKeyBindingDeps): void {
  const { editor, tui, chatLog, client, state, mouseHandler } = deps;

  editor.onEscape = () => {
    void deps.abortActive();
  };

  editor.onCtrlC = () => {
    const now = Date.now();
    // Tri-state, in priority order:
    //   1. an active run → abort it
    //   2. non-empty input → clear it
    //   3. double Ctrl+C within 1s → exit
    // Escape remains a secondary abort path.
    if (state.activeChatRunId) {
      void deps.abortActive();
      return;
    }
    if (editor.getText().trim().length > 0) {
      editor.setText("");
      deps.setActivityStatus("cleared input");
      tui.requestRender();
      return;
    }
    if (now - state.lastCtrlCAt < 1000) {
      mouseHandler.disable();
      client.stop();
      tui.stop();
      process.exit(0);
    }
    state.lastCtrlCAt = now;
    deps.setActivityStatus("press ctrl+c again to exit");
    tui.requestRender();
  };

  editor.onCtrlD = () => {
    mouseHandler.disable();
    client.stop();
    tui.stop();
    process.exit(0);
  };

  editor.onCtrlO = () => {
    const next: SectionState = nextSectionState(state.toolSectionState);
    state.toolSectionState = next;
    state.toolsExpanded = next === "expanded";
    chatLog.setToolSectionState(next);
    deps.setActivityStatus(`tools: ${next}`);
    tui.requestRender();
  };

  editor.onCtrlL = () => {
    void deps.openModelSelector();
  };

  editor.onCtrlG = () => {
    void deps.openAgentSelector();
  };

  editor.onCtrlP = () => {
    void deps.openSessionSelector();
  };

  editor.onCtrlT = () => {
    const next: SectionState = nextSectionState(state.thinkingSectionState);
    state.thinkingSectionState = next;
    // Thinking text is baked into the assistant message at compose time, so
    // toggling requires reloading history. "hidden" suppresses thinking;
    // "collapsed" and "expanded" both show it (a truncated mode would require
    // restructuring the composer — deferred to a follow-up).
    state.showThinking = next !== "hidden";
    void deps.loadHistory();
  };

  editor.onShiftTab = () => {
    const modes: Array<"auto" | "ask" | "deny"> = ["auto", "ask", "deny"];
    const current = state.permissionMode ?? "auto";
    const idx = modes.indexOf(current);
    const nextMode = modes[(idx + 1) % modes.length] ?? "auto";
    state.permissionMode = nextMode;
    deps.setActivityStatus(`permission: ${nextMode}`);
    tui.requestRender();
  };
}
