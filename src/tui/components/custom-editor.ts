import { Editor, Key, matchesKey } from "@earendil-works/pi-tui";
import type { ClipboardImage } from "../clipboard-image.js";
import type { TuiKeybindingResolver } from "../keybinding-resolver.js";

const BRACKET_PASTE_START = "\x1b[200~";
const BRACKET_PASTE_END = "\x1b[201~";

export type ImagePasteEvent = {
  base64: string;
  mimeType: string;
  marker: string;
};

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
  onImagePaste?: (image: ImagePasteEvent) => void;
  tuiResolver?: TuiKeybindingResolver;

  private imageCounter = 0;
  captureClipboardImage: (() => ClipboardImage | null) | null = null;

  handleInput(data: string): void {
    // Ctrl+V: primary image paste trigger.
    // macOS terminals don't send any data for Cmd+V when clipboard has an image,
    // so we use Ctrl+V as the explicit image paste shortcut.
    if (this.captureClipboardImage && matchesKey(data, Key.ctrl("v"))) {
      const image = this.captureClipboardImage();
      if (image) {
        this.imageCounter++;
        const marker = `[Image #${this.imageCounter}]`;
        this.insertTextAtCursor(`${marker} `);
        this.onImagePaste?.({ base64: image.base64, mimeType: image.mimeType, marker });
        return;
      }
      // No image on clipboard — fall through to let parent handle Ctrl+V normally
    }
    // Fallback: intercept empty bracketed paste — some terminals send this for image pastes
    if (this.captureClipboardImage && this.isEmptyBracketedPaste(data)) {
      const image = this.captureClipboardImage();
      if (image) {
        this.imageCounter++;
        const marker = `[Image #${this.imageCounter}]`;
        this.insertTextAtCursor(`${marker} `);
        this.onImagePaste?.({ base64: image.base64, mimeType: image.mimeType, marker });
        return;
      }
      // No image on clipboard — ignore the empty paste
      return;
    }
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
    if (matchesKey(data, Key.escape) && !this.isShowingAutocomplete()) {
      if (this.onEscape) {
        this.onEscape();
        return;
      }
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

  private isEmptyBracketedPaste(data: string): boolean {
    const startIdx = data.indexOf(BRACKET_PASTE_START);
    if (startIdx < 0) return false;
    const endIdx = data.indexOf(BRACKET_PASTE_END, startIdx + BRACKET_PASTE_START.length);
    if (endIdx < 0) return false;
    const content = data.slice(startIdx + BRACKET_PASTE_START.length, endIdx);
    return content.trim().length === 0;
  }
}
