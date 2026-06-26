import type { Component } from "@earendil-works/pi-tui";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import { AssistantMessageComponent } from "./assistant-message.js";
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

export class ChatLog extends Container {
  private readonly maxComponents: number;
  private toolById = new Map<string, ToolExecutionComponent>();
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  private toolsExpanded = false;
  private _lastAssistantText = "";
  private _scrollOffset = 0;
  private _totalRenderedLines = 0;

  constructor(maxComponents = 180) {
    super();
    this.maxComponents = Math.max(20, Math.floor(maxComponents));
  }

  /**
   * Scroll the chat log by a number of lines.
   * Positive = scroll up (toward older content), negative = scroll down.
   */
  scrollBy(lines: number): void {
    this._scrollOffset = Math.max(0, this._scrollOffset + lines);
  }

  /** Scroll to the bottom (most recent content). */
  scrollToBottom(): void {
    this._scrollOffset = 0;
  }

  /** True when the user has scrolled away from the bottom. */
  isScrolledUp(): boolean {
    return this._scrollOffset > 0;
  }

  /** Current scroll offset in lines. */
  getScrollOffset(): number {
    return this._scrollOffset;
  }

  render(width: number): string[] {
    const allLines = super.render(width);
    this._totalRenderedLines = allLines.length;

    if (this._scrollOffset <= 0) return allLines;

    // Clamp scroll offset to total lines
    if (this._scrollOffset >= allLines.length) {
      this._scrollOffset = Math.max(0, allLines.length - 1);
    }

    const end = allLines.length - this._scrollOffset;
    const visible = allLines.slice(0, end);

    // Append scroll indicator
    const pct = Math.round(((allLines.length - this._scrollOffset) / allLines.length) * 100);
    visible.push(theme.dim(`── scrolled up ${this._scrollOffset} lines (${pct}%) ──`));

    return visible;
  }

  private dropComponentReferences(component: Component) {
    for (const [toolId, tool] of this.toolById.entries()) {
      if (tool === component) {
        this.toolById.delete(toolId);
      }
    }
    for (const [runId, message] of this.streamingRuns.entries()) {
      if (message === component) {
        this.streamingRuns.delete(runId);
      }
    }
  }

  private pruneOverflow() {
    while (this.children.length > this.maxComponents) {
      const oldest = this.children[0];
      if (!oldest) {
        return;
      }
      this.removeChild(oldest);
      this.dropComponentReferences(oldest);
    }
  }

  private append(component: Component) {
    this.addChild(component);
    this.pruneOverflow();
    // Auto-scroll to bottom on new content
    this._scrollOffset = 0;
  }

  clearAll() {
    this.clear();
    this.toolById.clear();
    this.streamingRuns.clear();
  }

  addWelcome(component: Component) {
    this.append(component);
  }

  addSystem(text: string) {
    this.append(new Spacer(1));
    this.append(new Text(theme.system(text), 1, 0));
  }

  addUser(text: string) {
    this.append(new UserMessageComponent(text));
  }

  private resolveRunId(runId?: string) {
    return runId ?? "default";
  }

  startAssistant(text: string, runId?: string) {
    const component = new AssistantMessageComponent(text);
    this.streamingRuns.set(this.resolveRunId(runId), component);
    this.append(component);
    return component;
  }

  updateAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      this.startAssistant(text, runId);
      return;
    }
    existing.setText(text);
  }

  finalizeAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      existing.setText(text);
      this.streamingRuns.delete(effectiveRunId);
      this._lastAssistantText = text;
      return;
    }
    this.append(new AssistantMessageComponent(text));
    this._lastAssistantText = text;
  }

  /** Get the text of the last finalized assistant response. */
  getLastAssistantText(): string {
    return this._lastAssistantText;
  }

  dropAssistant(runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      return;
    }
    this.removeChild(existing);
    this.streamingRuns.delete(effectiveRunId);
  }

  startTool(toolCallId: string, toolName: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return existing;
    }
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);
    this.append(component);
    return component;
  }

  updateToolArgs(toolCallId: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setArgs(args);
  }

  updateToolResult(
    toolCallId: string,
    result: unknown,
    opts?: { isError?: boolean; partial?: boolean },
  ) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    if (opts?.partial) {
      existing.setPartialResult(result as Record<string, unknown>);
      return;
    }
    existing.setResult(result as Record<string, unknown>, {
      isError: opts?.isError,
    });
  }

  setToolsExpanded(expanded: boolean) {
    this.toolsExpanded = expanded;
    for (const tool of this.toolById.values()) {
      tool.setExpanded(expanded);
    }
  }
}
