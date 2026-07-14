/**
 * Display/style command group.
 * Commands: style, theme, diff, permission, fast, tools
 */

import { execSync } from "node:child_process";
import { renderDiff, renderDiffStats } from "./diff-renderer.js";
import { theme } from "./theme/theme.js";
import { isValidOutputStyle, OUTPUT_STYLE_NAMES } from "./output-styles.js";
import type { OutputStyle } from "./output-styles.js";
import { THEME_PRESETS, listCustomThemeNames } from "./theme/palettes.js";
import type { BuiltinPreset } from "./theme/palettes.js";
import { setThemePreset, getThemePreset } from "./theme/theme.js";
import { createSelectList } from "./components/selectors.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

const logger = createSubsystemLogger("tui");

export const displayCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const { client, chatLog, tui, state, applySessionInfoFromPatch } = ctx;

  switch (name) {
    case "diff": {
      try {
        const cmd = args ? `git diff -- ${args}` : "git diff";
        const raw = execSync(cmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 }).trim();
        if (!raw) {
          chatLog.addSystem("no changes");
          return true;
        }
        const stats = renderDiffStats(raw);
        chatLog.addSystem(
          `${stats.files} file(s) changed, +${stats.additions} -${stats.deletions}`,
        );
        for (const line of renderDiff(raw, {
          add: theme.success,
          del: theme.error,
          header: (t) => theme.bold(t),
          hunk: theme.accent,
          context: theme.dim,
        })) {
          chatLog.addSystem(line);
        }
      } catch (err) {
        chatLog.addSystem(`diff failed: ${String(err)}`);
      }
      return true;
    }
    case "style": {
      const styleName = args.toLowerCase();
      if (!styleName) {
        const currentStyle = state.outputStyle ?? "standard";
        const styleItems = OUTPUT_STYLE_NAMES.map((s) => ({
          value: s,
          label: s === currentStyle ? `${s} (current)` : s,
        }));
        const styleSelector = createSelectList(styleItems, styleItems.length);
        styleSelector.onSelect = (item) => {
          state.outputStyle = item.value as OutputStyle;
          chatLog.addSystem(`output style set to ${item.value}`);
          ctx.closeOverlay();
          tui.requestRender();
        };
        styleSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(styleSelector);
        tui.requestRender();
        return true;
      }
      if (!isValidOutputStyle(styleName)) {
        chatLog.addSystem(`unknown style. usage: /style <${OUTPUT_STYLE_NAMES.join("|")}>`);
        return true;
      }
      state.outputStyle = styleName;
      chatLog.addSystem(`output style set to ${styleName}`);
      return true;
    }
    case "theme": {
      const preset = args.toLowerCase();
      if (!preset) {
        const currentTheme = getThemePreset();
        const themeItems = THEME_PRESETS.map((t) => ({
          value: t,
          label: t === currentTheme ? `${t} (current)` : t,
        }));
        const themeSelector = createSelectList(themeItems, themeItems.length);
        themeSelector.onSelect = (item) => {
          setThemePreset(item.value);
          chatLog.addSystem(`theme set to ${item.value}`);
          ctx.closeOverlay();
          tui.requestRender();
        };
        themeSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(themeSelector);
        tui.requestRender();
        return true;
      }
      if (
        !THEME_PRESETS.includes(preset as BuiltinPreset) &&
        !listCustomThemeNames().includes(preset)
      ) {
        chatLog.addSystem(
          `unknown theme. usage: /theme <${THEME_PRESETS.join("|")}> or a custom theme name`,
        );
        return true;
      }
      setThemePreset(preset);
      chatLog.addSystem(`theme set to ${preset}`);
      return true;
    }
    case "permission": {
      const MODES = ["auto", "ask", "deny"] as const;
      type PermMode = (typeof MODES)[number];
      const mode = args.toLowerCase();
      if (!mode) {
        const current = state.permissionMode ?? "auto";
        const idx = MODES.indexOf(current);
        const next = MODES[(idx + 1) % MODES.length] as PermMode;
        state.permissionMode = next;
        chatLog.addSystem(`permission mode: ${next}`);
      } else if (MODES.includes(mode as PermMode)) {
        state.permissionMode = mode as PermMode;
        chatLog.addSystem(`permission mode set to ${mode}`);
      } else {
        chatLog.addSystem("usage: /permission <auto|ask|deny>");
      }
      return true;
    }
    case "fast": {
      const isFast = !state.fastMode;
      state.fastMode = isFast;
      if (isFast) {
        // Save current thinking level before switching
        state.previousThinkingLevel = state.sessionInfo.thinkingLevel ?? "medium";
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: "off",
          });
          applySessionInfoFromPatch(result);
        } catch (err) {
          // Best-effort — fast mode works locally even without gateway
          logger.warn("fast-mode: failed to set thinking off", { error: String(err) });
        }
        state.outputStyle = "standard";
        chatLog.addSystem("fast mode enabled (thinking: off, style: standard)");
      } else {
        // Restore previous thinking level
        const prevLevel = state.previousThinkingLevel ?? "medium";
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: prevLevel,
          });
          applySessionInfoFromPatch(result);
        } catch (err) {
          // Best-effort — restore may fail if gateway is unreachable
          logger.warn("fast-mode: failed to restore thinking", {
            level: prevLevel,
            error: String(err),
          });
        }
        chatLog.addSystem(`fast mode disabled (thinking: ${prevLevel})`);
      }
      return true;
    }
    case "tools": {
      await ctx.sendMessage(
        "List every tool name you have access to. Output ONLY a numbered list of tool names, nothing else. " +
          "Do NOT describe them. Just the names, one per line.",
        "/tools",
      );
      return true;
    }
    default:
      return false;
  }
};
