import { Box, Container, Image, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { formatToolDetail, resolveToolDisplay } from "../../agents/tool-display.js";
import { renderDiff, parseDiffStats, formatDiffStatsLine } from "../diff-renderer.js";
import { linkifyFilePaths } from "../linkify-paths.js";
import { markdownTheme, theme } from "../theme/theme.js";
import { sanitizeRenderableText } from "../tui-formatters.js";

type ToolResultContent = {
  type?: string;
  text?: string;
  mimeType?: string;
  bytes?: number;
  omitted?: boolean;
  /** Base64-encoded image data, retained for inline rendering. */
  data?: string;
};

type ToolResult = {
  content?: ToolResultContent[];
  details?: Record<string, unknown>;
};

const PREVIEW_LINES = 12;
const DIFF_TOOLS = new Set(["code_edit", "code_write", "code_multi_edit"]);
const DIFF_PREVIEW_LINES = 20;

function formatArgs(toolName: string, args: unknown): string {
  const display = resolveToolDisplay({ name: toolName, args });
  const detail = formatToolDetail(display);
  if (detail) {
    return sanitizeRenderableText(detail);
  }
  if (!args || typeof args !== "object") {
    return "";
  }
  try {
    return sanitizeRenderableText(JSON.stringify(args));
  } catch {
    return "";
  }
}

function extractText(result?: ToolResult): string {
  if (!result?.content) {
    return "";
  }
  const lines: string[] = [];
  for (const entry of result.content) {
    if (entry.type === "text" && entry.text) {
      lines.push(sanitizeRenderableText(entry.text));
    } else if (entry.type === "image") {
      const mime = entry.mimeType ?? "image";
      const size = entry.bytes ? ` ${Math.round(entry.bytes / 1024)}kb` : "";
      const omitted = entry.omitted ? " (omitted)" : "";
      lines.push(`[${mime}${size}${omitted}]`);
    }
  }
  return lines.join("\n").trim();
}

export class ToolExecutionComponent extends Container {
  private box: Box;
  private header: Text;
  private argsLine: Text;
  private output: Markdown;
  private imageContainer: Container;
  private toolName: string;
  private args: unknown;
  private result?: ToolResult;
  private sectionState: import("../tui-types.js").SectionState = "collapsed";
  private isError = false;
  private isPartial = true;

  constructor(toolName: string, args: unknown) {
    super();
    this.toolName = toolName;
    this.args = args;
    this.box = new Box(1, 1, (line) => theme.toolPendingBg(line));
    this.header = new Text("", 0, 0);
    this.argsLine = new Text("", 0, 0);
    this.output = new Markdown("", 0, 0, markdownTheme, {
      color: (line) => theme.toolOutput(line),
    });
    this.imageContainer = new Container();
    this.addChild(new Spacer(1));
    this.addChild(this.box);
    this.box.addChild(this.header);
    this.box.addChild(this.argsLine);
    this.box.addChild(this.output);
    this.box.addChild(this.imageContainer);
    this.refresh();
  }

  setArgs(args: unknown) {
    this.args = args;
    this.refresh();
  }

  setExpanded(expanded: boolean) {
    this.sectionState = expanded ? "expanded" : "collapsed";
    this.refresh();
  }

  setSectionState(state: import("../tui-types.js").SectionState) {
    this.sectionState = state;
    this.refresh();
  }

  /** When hidden, the component renders only the header line. */
  get isHidden(): boolean {
    return this.sectionState === "hidden";
  }

  setResult(result: ToolResult | undefined, opts?: { isError?: boolean }) {
    this.result = result;
    this.isPartial = false;
    this.isError = Boolean(opts?.isError);
    this.refresh();
  }

  setPartialResult(result: ToolResult | undefined) {
    this.result = result;
    this.isPartial = true;
    this.refresh();
  }

  private refresh() {
    const bg = this.isPartial
      ? theme.toolPendingBg
      : this.isError
        ? theme.toolErrorBg
        : theme.toolSuccessBg;
    this.box.setBgFn((line) => bg(line));

    const display = resolveToolDisplay({
      name: this.toolName,
      args: this.args,
    });
    const title = `${display.emoji} ${display.label}${this.isPartial ? " (running)" : ""}`;
    this.header.setText(theme.toolTitle(theme.bold(title)));

    const argLine = formatArgs(this.toolName, this.args);
    this.argsLine.setText(
      argLine ? linkifyFilePaths(argLine, { color: theme.filePath }) : theme.dim(" "),
    );

    const raw = extractText(this.result);
    const isDiff = DIFF_TOOLS.has(this.toolName) && raw && !this.isPartial;

    // Hidden: only the header line, no output body.
    if (this.sectionState === "hidden") {
      this.output.setText("");
      this.imageContainer.clear();
      return;
    }

    // Render inline images from image content blocks that carry base64 data.
    // The Image component handles terminal capability detection internally
    // (Kitty/iTerm2) and falls back to a text placeholder when unsupported.
    this.imageContainer.clear();
    if (this.result?.content && !this.isPartial) {
      for (const entry of this.result.content) {
        if (entry.type === "image" && entry.data) {
          const mime = entry.mimeType ?? "image/png";
          try {
            const img = new Image(entry.data, mime, { fallbackColor: theme.dim });
            this.imageContainer.addChild(img);
          } catch {
            // If Image construction fails, the text placeholder from
            // extractText already covers this block.
          }
        }
      }
    }

    const isExpanded = this.sectionState === "expanded";

    if (isDiff) {
      const colored = renderDiff(raw, {
        add: theme.success,
        del: theme.error,
        header: (t) => theme.bold(t),
        hunk: theme.accent,
        context: theme.dim,
      });
      const stats = parseDiffStats(raw);
      const statsLine = formatDiffStatsLine(stats, {
        add: theme.success,
        del: theme.error,
      });
      const maxLines = isExpanded ? Infinity : DIFF_PREVIEW_LINES;
      const display =
        colored.length > maxLines
          ? [...colored.slice(0, maxLines), "…", statsLine]
          : [...colored, "", statsLine];
      this.output.setText(display.join("\n"));
    } else {
      const text = raw
        ? linkifyFilePaths(raw, { color: theme.filePath })
        : this.isPartial
          ? "…"
          : "";
      if (!isExpanded && text) {
        const lines = text.split("\n");
        const preview =
          lines.length > PREVIEW_LINES ? `${lines.slice(0, PREVIEW_LINES).join("\n")}\n…` : text;
        this.output.setText(preview);
      } else {
        this.output.setText(text);
      }
    }
  }
}
