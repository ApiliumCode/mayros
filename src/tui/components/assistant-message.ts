import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { findStableBoundary } from "../stream-boundary.js";
import { markdownTheme, theme } from "../theme/theme.js";

/**
 * Renders an assistant message with incremental markdown parsing.
 *
 * The text is split at the last stable block boundary (see findStableBoundary)
 * into a stable prefix and an active suffix. Only the suffix is re-parsed on
 * each streaming delta; the prefix reuses the Markdown component's internal
 * render cache, turning the per-delta cost from O(n²) into O(n).
 */
export class AssistantMessageComponent extends Container {
  private stablePrefix: Markdown;
  private activeSuffix: Markdown;
  private committedPrefixText = "";

  constructor(text: string) {
    super();
    this.addChild(new Spacer(1));
    this.stablePrefix = this.createMarkdown("");
    this.activeSuffix = this.createMarkdown("");
    this.addChild(this.stablePrefix);
    this.addChild(this.activeSuffix);
    if (text) this.setText(text);
  }

  private createMarkdown(text: string): Markdown {
    return new Markdown(text, 1, 0, markdownTheme, {
      // Keep assistant body text in terminal default foreground so contrast
      // follows the user's terminal theme (dark or light).
      color: (line) => theme.assistantText(line),
    });
  }

  setText(text: string) {
    const boundary = findStableBoundary(text);
    const prefixText = boundary > 0 ? text.slice(0, boundary) : "";
    const suffixText = boundary > 0 ? text.slice(boundary) : text;

    // Only update the prefix when it actually grew — this is what lets the
    // Markdown cache hit on every delta once a block is committed.
    if (prefixText !== this.committedPrefixText) {
      this.committedPrefixText = prefixText;
      this.stablePrefix.setText(prefixText);
    }
    // The suffix always changes on each delta.
    this.activeSuffix.setText(suffixText);
  }
}
