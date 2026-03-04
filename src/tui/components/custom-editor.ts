import { Editor, Key, matchesKey } from "@mariozechner/pi-tui";
import type { TuiKeybindingResolver } from "../keybinding-resolver.js";

export class CustomEditor extends Editor {
  onEscape?: () => void;
  onCtrlC?: () => void;
  onCtrlD?: () => void;
  onCtrlG?: () => void;
  onCtrlL?: () => void;
  onCtrlO?: () => void;
  onCtrlP?: () => void;
  onCtrlT?: () => void;
  onShiftTab?: () => void;
  onAltEnter?: () => void;
  tuiResolver?: TuiKeybindingResolver;

  handleInput(data: string): void {
    if (matchesKey(data, Key.alt("enter")) && this.onAltEnter) {
      this.onAltEnter();
      return;
    }
    // Use resolver for TUI actions when available, fall back to hard-coded keys.
    const resolver = this.tuiResolver;
    if (resolver) {
      if (resolver.matches(data, "selectModel") && this.onCtrlL) {
        this.onCtrlL();
        return;
      }
      if (resolver.matches(data, "toggleTools") && this.onCtrlO) {
        this.onCtrlO();
        return;
      }
      if (resolver.matches(data, "selectSession") && this.onCtrlP) {
        this.onCtrlP();
        return;
      }
      if (resolver.matches(data, "selectAgent") && this.onCtrlG) {
        this.onCtrlG();
        return;
      }
      if (resolver.matches(data, "toggleThinking") && this.onCtrlT) {
        this.onCtrlT();
        return;
      }
    } else {
      if (matchesKey(data, Key.ctrl("l")) && this.onCtrlL) {
        this.onCtrlL();
        return;
      }
      if (matchesKey(data, Key.ctrl("o")) && this.onCtrlO) {
        this.onCtrlO();
        return;
      }
      if (matchesKey(data, Key.ctrl("p")) && this.onCtrlP) {
        this.onCtrlP();
        return;
      }
      if (matchesKey(data, Key.ctrl("g")) && this.onCtrlG) {
        this.onCtrlG();
        return;
      }
      if (matchesKey(data, Key.ctrl("t")) && this.onCtrlT) {
        this.onCtrlT();
        return;
      }
    }
    if (matchesKey(data, Key.shift("tab")) && this.onShiftTab) {
      this.onShiftTab();
      return;
    }
    if (matchesKey(data, Key.escape) && this.onEscape && !this.isShowingAutocomplete()) {
      this.onEscape();
      return;
    }
    if (matchesKey(data, Key.ctrl("c")) && this.onCtrlC) {
      this.onCtrlC();
      return;
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      if (this.getText().length === 0 && this.onCtrlD) {
        this.onCtrlD();
      }
      return;
    }
    super.handleInput(data);
  }
}
