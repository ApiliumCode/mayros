export type VimMode = "normal" | "insert";

type MotionResult =
  | {
      type: "cursor";
      delta: number;
    }
  | {
      type: "line-start" | "line-end" | "word-forward" | "word-backward";
    };

type OperatorPending = "d" | "c" | "y" | null;

export type VimState = {
  mode: VimMode;
  countPrefix: string;
  operator: OperatorPending;
  lastYank: string;
};

export type EditorBridge = {
  getText: () => string;
  setText: (value: string) => void;
  getCursorPosition: () => { line: number; col: number };
  setCursorPosition: (line: number, col: number) => void;
};

export class VimHandler {
  private state: VimState;
  private bridge: EditorBridge | null = null;
  private undoStack: string[] = [];
  private maxUndo = 50;

  constructor() {
    this.state = {
      mode: "insert",
      countPrefix: "",
      operator: null,
      lastYank: "",
    };
  }

  setBridge(bridge: EditorBridge): void {
    this.bridge = bridge;
  }

  getMode(): VimMode {
    return this.state.mode;
  }

  getModeIndicator(): string {
    return this.state.mode === "normal" ? "-- NORMAL --" : "-- INSERT --";
  }

  isNormalMode(): boolean {
    return this.state.mode === "normal";
  }

  enable(): void {
    this.state.mode = "normal";
    this.state.countPrefix = "";
    this.state.operator = null;
  }

  disable(): void {
    this.state.mode = "insert";
    this.state.countPrefix = "";
    this.state.operator = null;
  }

  /**
   * Handle a keypress in vim mode.
   * Returns true if the key was consumed (not passed to editor).
   */
  handleKey(key: string): boolean {
    if (this.state.mode === "insert") {
      // Escape → switch to normal mode
      if (key === "\x1b" || key === "\u001b") {
        this.state.mode = "normal";
        this.state.countPrefix = "";
        this.state.operator = null;
        return true;
      }
      return false;
    }

    // Normal mode
    return this.handleNormalMode(key);
  }

  private getCount(): number {
    const n = parseInt(this.state.countPrefix, 10);
    this.state.countPrefix = "";
    return isNaN(n) || n < 1 ? 1 : Math.min(n, 999);
  }

  private pushUndo(): void {
    if (!this.bridge) return;
    const text = this.bridge.getText();
    this.undoStack.push(text);
    if (this.undoStack.length > this.maxUndo) {
      this.undoStack.shift();
    }
  }

  private handleNormalMode(key: string): boolean {
    // Count prefix accumulation
    if (/^[1-9]$/.test(key) || (this.state.countPrefix.length > 0 && /^[0-9]$/.test(key))) {
      this.state.countPrefix += key;
      return true;
    }

    // Operator pending (d, c, y)
    if (this.state.operator === null && (key === "d" || key === "c" || key === "y")) {
      this.state.operator = key;
      return true;
    }

    // dd, cc, yy — whole-line operations
    if (this.state.operator && key === this.state.operator) {
      const count = this.getCount();
      this.handleLinewiseOp(this.state.operator, count);
      this.state.operator = null;
      return true;
    }

    // operator + motion
    if (this.state.operator) {
      const motion = this.resolveMotion(key);
      if (motion) {
        this.handleOperatorMotion(this.state.operator, motion);
        this.state.operator = null;
        return true;
      }
      // Invalid motion — cancel operator
      this.state.operator = null;
      this.state.countPrefix = "";
      return true;
    }

    const count = this.getCount();

    // Mode switches
    switch (key) {
      case "i":
        this.state.mode = "insert";
        return true;
      case "a":
        this.state.mode = "insert";
        this.moveCursor(1);
        return true;
      case "I":
        this.state.mode = "insert";
        this.moveToLineStart();
        return true;
      case "A":
        this.state.mode = "insert";
        this.moveToLineEnd();
        return true;
      case "o":
        this.state.mode = "insert";
        this.insertLineBelow();
        return true;
      case "O":
        this.state.mode = "insert";
        this.insertLineAbove();
        return true;
    }

    // Motions
    switch (key) {
      case "h":
        this.moveCursor(-count);
        return true;
      case "l":
        this.moveCursor(count);
        return true;
      case "j":
        this.moveVertical(count);
        return true;
      case "k":
        this.moveVertical(-count);
        return true;
      case "w":
        for (let i = 0; i < count; i++) this.moveWordForward();
        return true;
      case "b":
        for (let i = 0; i < count; i++) this.moveWordBackward();
        return true;
      case "0":
        this.moveToLineStart();
        return true;
      case "$":
        this.moveToLineEnd();
        return true;
    }

    // Editing commands
    switch (key) {
      case "x":
        this.deleteCharsAtCursor(count);
        return true;
      case "D":
        this.deleteToEndOfLine();
        return true;
      case "C":
        this.deleteToEndOfLine();
        this.state.mode = "insert";
        return true;
      case "p":
        this.paste();
        return true;
      case "u":
        this.undo();
        return true;
    }

    return true;
  }

  private resolveMotion(key: string): MotionResult | null {
    switch (key) {
      case "h":
        return { type: "cursor", delta: -1 };
      case "l":
        return { type: "cursor", delta: 1 };
      case "w":
        return { type: "word-forward" };
      case "b":
        return { type: "word-backward" };
      case "0":
        return { type: "line-start" };
      case "$":
        return { type: "line-end" };
      default:
        return null;
    }
  }

  private handleLinewiseOp(op: OperatorPending, count: number): void {
    if (!this.bridge) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line } = this.bridge.getCursorPosition();
    const start = Math.min(line, lines.length - 1);
    const end = Math.min(start + count, lines.length);
    const deleted = lines.splice(start, end - start);
    this.state.lastYank = deleted.join("\n");

    if (op === "d" || op === "c") {
      this.bridge.setText(lines.join("\n"));
      const newLine = Math.min(start, Math.max(0, lines.length - 1));
      this.bridge.setCursorPosition(newLine, 0);
    }
    if (op === "c") {
      this.state.mode = "insert";
    }
  }

  private handleOperatorMotion(op: OperatorPending, _motion: MotionResult): void {
    // Simplified: for non-linewise motions, behave like single-char operations
    if (!this.bridge) return;
    if (op === "d") {
      this.deleteCharsAtCursor(1);
    } else if (op === "c") {
      this.deleteCharsAtCursor(1);
      this.state.mode = "insert";
    } else if (op === "y") {
      const text = this.bridge.getText();
      const lines = text.split("\n");
      const { line } = this.bridge.getCursorPosition();
      this.state.lastYank = lines[line] ?? "";
    }
  }

  private moveCursor(delta: number): void {
    if (!this.bridge) return;
    const { line, col } = this.bridge.getCursorPosition();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const currentLine = lines[line] ?? "";
    const newCol = Math.max(0, Math.min(currentLine.length, col + delta));
    this.bridge.setCursorPosition(line, newCol);
  }

  private moveVertical(delta: number): void {
    if (!this.bridge) return;
    const { line, col } = this.bridge.getCursorPosition();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const newLine = Math.max(0, Math.min(lines.length - 1, line + delta));
    const targetLine = lines[newLine] ?? "";
    const newCol = Math.min(col, targetLine.length);
    this.bridge.setCursorPosition(newLine, newCol);
  }

  private moveToLineStart(): void {
    if (!this.bridge) return;
    const { line } = this.bridge.getCursorPosition();
    this.bridge.setCursorPosition(line, 0);
  }

  private moveToLineEnd(): void {
    if (!this.bridge) return;
    const { line } = this.bridge.getCursorPosition();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const currentLine = lines[line] ?? "";
    this.bridge.setCursorPosition(line, currentLine.length);
  }

  private moveWordForward(): void {
    if (!this.bridge) return;
    const { line, col } = this.bridge.getCursorPosition();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const currentLine = lines[line] ?? "";

    let newCol = col;
    // Skip current word chars
    while (newCol < currentLine.length && /\w/.test(currentLine[newCol] ?? "")) {
      newCol++;
    }
    // Skip whitespace
    while (newCol < currentLine.length && /\s/.test(currentLine[newCol] ?? "")) {
      newCol++;
    }
    if (newCol >= currentLine.length && line < lines.length - 1) {
      this.bridge.setCursorPosition(line + 1, 0);
    } else {
      this.bridge.setCursorPosition(line, newCol);
    }
  }

  private moveWordBackward(): void {
    if (!this.bridge) return;
    const { line, col } = this.bridge.getCursorPosition();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const currentLine = lines[line] ?? "";

    let newCol = col;
    if (newCol > 0) newCol--;
    // Skip whitespace backwards
    while (newCol > 0 && /\s/.test(currentLine[newCol] ?? "")) {
      newCol--;
    }
    // Skip word chars backwards
    while (newCol > 0 && /\w/.test(currentLine[newCol - 1] ?? "")) {
      newCol--;
    }
    if (newCol <= 0 && col === 0 && line > 0) {
      const prevLine = lines[line - 1] ?? "";
      this.bridge.setCursorPosition(line - 1, prevLine.length);
    } else {
      this.bridge.setCursorPosition(line, newCol);
    }
  }

  private deleteCharsAtCursor(count: number): void {
    if (!this.bridge) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line, col } = this.bridge.getCursorPosition();
    const currentLine = lines[line] ?? "";
    const deleted = currentLine.slice(col, col + count);
    this.state.lastYank = deleted;
    lines[line] = currentLine.slice(0, col) + currentLine.slice(col + count);
    this.bridge.setText(lines.join("\n"));
    this.bridge.setCursorPosition(line, Math.min(col, (lines[line] ?? "").length));
  }

  private deleteToEndOfLine(): void {
    if (!this.bridge) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line, col } = this.bridge.getCursorPosition();
    const currentLine = lines[line] ?? "";
    this.state.lastYank = currentLine.slice(col);
    lines[line] = currentLine.slice(0, col);
    this.bridge.setText(lines.join("\n"));
  }

  private insertLineBelow(): void {
    if (!this.bridge) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line } = this.bridge.getCursorPosition();
    lines.splice(line + 1, 0, "");
    this.bridge.setText(lines.join("\n"));
    this.bridge.setCursorPosition(line + 1, 0);
  }

  private insertLineAbove(): void {
    if (!this.bridge) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line } = this.bridge.getCursorPosition();
    lines.splice(line, 0, "");
    this.bridge.setText(lines.join("\n"));
    this.bridge.setCursorPosition(line, 0);
  }

  private paste(): void {
    if (!this.bridge || !this.state.lastYank) return;
    this.pushUndo();
    const text = this.bridge.getText();
    const lines = text.split("\n");
    const { line, col } = this.bridge.getCursorPosition();
    const currentLine = lines[line] ?? "";
    lines[line] = currentLine.slice(0, col + 1) + this.state.lastYank + currentLine.slice(col + 1);
    this.bridge.setText(lines.join("\n"));
    this.bridge.setCursorPosition(line, col + this.state.lastYank.length);
  }

  private undo(): void {
    if (!this.bridge || this.undoStack.length === 0) return;
    const prev = this.undoStack.pop()!;
    this.bridge.setText(prev);
    const lines = prev.split("\n");
    this.bridge.setCursorPosition(Math.min(lines.length - 1, 0), 0);
  }
}
