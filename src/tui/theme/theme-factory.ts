import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { highlight, supportsLanguage } from "cli-highlight";
import { formatTerminalLink } from "../../utils.js";
import { stripAnsi } from "../../terminal/ansi.js";
import type { SearchableSelectListTheme } from "../components/searchable-select-list.js";
import type { Palette } from "./palettes.js";
import { createSyntaxTheme } from "./syntax-theme.js";

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

export type ThemeSet = {
  theme: {
    fg: (text: string) => string;
    assistantText: (text: string) => string;
    dim: (text: string) => string;
    accent: (text: string) => string;
    accentSoft: (text: string) => string;
    success: (text: string) => string;
    error: (text: string) => string;
    header: (text: string) => string;
    system: (text: string) => string;
    userBg: (text: string) => string;
    userText: (text: string) => string;
    toolTitle: (text: string) => string;
    toolOutput: (text: string) => string;
    toolPendingBg: (text: string) => string;
    toolSuccessBg: (text: string) => string;
    toolErrorBg: (text: string) => string;
    border: (text: string) => string;
    filePath: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
  };
  markdownTheme: MarkdownTheme;
  editorTheme: EditorTheme;
  selectListTheme: SelectListTheme;
  filterableSelectListTheme: SelectListTheme & { filterLabel: (text: string) => string };
  settingsListTheme: SettingsListTheme;
  searchableSelectListTheme: SearchableSelectListTheme;
};

function createHighlightCode(palette: Palette) {
  const syntaxTheme = createSyntaxTheme(fg(palette.code));
  return function highlightCode(code: string, lang?: string): string[] {
    try {
      const language = lang && supportsLanguage(lang) ? lang : undefined;
      const highlighted = highlight(code, {
        language,
        theme: syntaxTheme,
        ignoreIllegals: true,
      });
      return highlighted.split("\n");
    } catch {
      return code.split("\n").map((line) => fg(palette.code)(line));
    }
  };
}

export function createThemeSet(palette: Palette): ThemeSet {
  const highlightCode = createHighlightCode(palette);

  const theme = {
    fg: fg(palette.text),
    assistantText: (text: string) => text,
    dim: fg(palette.dim),
    accent: fg(palette.accent),
    accentSoft: fg(palette.accentSoft),
    success: fg(palette.success),
    error: fg(palette.error),
    header: (text: string) => chalk.bold(fg(palette.accent)(text)),
    system: fg(palette.systemText),
    userBg: bg(palette.userBg),
    userText: fg(palette.userText),
    toolTitle: fg(palette.toolTitle),
    toolOutput: fg(palette.toolOutput),
    toolPendingBg: bg(palette.toolPendingBg),
    toolSuccessBg: bg(palette.toolSuccessBg),
    toolErrorBg: bg(palette.toolErrorBg),
    border: fg(palette.border),
    filePath: fg(palette.filePath),
    bold: (text: string) => chalk.bold(text),
    italic: (text: string) => chalk.italic(text),
  };

  const markdownTheme: MarkdownTheme = {
    heading: (text) => chalk.bold(fg(palette.accent)(text)),
    link: (text) => {
      // Autolinks: text is the URL itself (e.g. "[https://...](https://...)")
      const plain = stripAnsi(text);
      if (/^https?:\/\//.test(plain)) {
        return formatTerminalLink(fg(palette.link)(text), plain, {
          fallback: fg(palette.link)(text),
        });
      }
      return fg(palette.link)(text);
    },
    linkUrl: (text) => {
      // pi-tui passes " (url)" — extract the URL
      const match = /\(\s*(https?:\/\/[^\s)]+)\s*\)/.exec(text);
      if (match?.[1]) {
        const url = match[1];
        const styled = chalk.dim(text);
        return formatTerminalLink(styled, url, { fallback: styled });
      }
      return chalk.dim(text);
    },
    code: (text) => fg(palette.code)(text),
    codeBlock: (text) => fg(palette.code)(text),
    codeBlockBorder: (text) => fg(palette.codeBorder)(text),
    quote: (text) => fg(palette.quote)(text),
    quoteBorder: (text) => fg(palette.quoteBorder)(text),
    hr: (text) => fg(palette.border)(text),
    listBullet: (text) => fg(palette.accentSoft)(text),
    bold: (text) => chalk.bold(text),
    italic: (text) => chalk.italic(text),
    strikethrough: (text) => chalk.strikethrough(text),
    underline: (text) => chalk.underline(text),
    highlightCode,
  };

  const baseSelectListTheme: SelectListTheme = {
    selectedPrefix: (text) => fg(palette.accent)(text),
    selectedText: (text) => chalk.bold(fg(palette.accent)(text)),
    description: (text) => fg(palette.dim)(text),
    scrollInfo: (text) => fg(palette.dim)(text),
    noMatch: (text) => fg(palette.dim)(text),
  };

  const filterableSelectListTheme = {
    ...baseSelectListTheme,
    filterLabel: (text: string) => fg(palette.dim)(text),
  };

  const settingsListTheme: SettingsListTheme = {
    label: (text, selected) =>
      selected ? chalk.bold(fg(palette.accent)(text)) : fg(palette.text)(text),
    value: (text, selected) => (selected ? fg(palette.accentSoft)(text) : fg(palette.dim)(text)),
    description: (text) => fg(palette.systemText)(text),
    cursor: fg(palette.accent)("→ "),
    hint: (text) => fg(palette.dim)(text),
  };

  const editorTheme: EditorTheme = {
    borderColor: (text) => fg(palette.border)(text),
    selectList: baseSelectListTheme,
  };

  const searchableSelectListTheme: SearchableSelectListTheme = {
    ...baseSelectListTheme,
    searchPrompt: (text) => fg(palette.accentSoft)(text),
    searchInput: (text) => fg(palette.text)(text),
    matchHighlight: (text) => chalk.bold(fg(palette.accent)(text)),
  };

  return {
    theme,
    markdownTheme,
    editorTheme,
    selectListTheme: baseSelectListTheme,
    filterableSelectListTheme,
    settingsListTheme,
    searchableSelectListTheme,
  };
}
