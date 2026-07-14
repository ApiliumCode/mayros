/**
 * Configuration command group.
 * Commands: think, verbose, reasoning, elevated, activation, usage, context
 */

import {
  listThinkingLevelLabels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import { formatContextVisualization } from "./context-visualizer.js";
import { createSelectList } from "./components/selectors.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const configCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const {
    client,
    chatLog,
    tui,
    state,
    refreshSessionInfo,
    loadHistory,
    applySessionInfoFromPatch,
  } = ctx;

  switch (name) {
    case "think":
      if (!args) {
        const levels = listThinkingLevelLabels(
          state.sessionInfo.modelProvider,
          state.sessionInfo.model,
        );
        const currentThink = state.sessionInfo.thinkingLevel ?? "medium";
        const thinkItems = levels.map((l) => ({
          value: l,
          label: l === currentThink ? `${l} (current)` : l,
        }));
        const thinkSelector = createSelectList(thinkItems, thinkItems.length);
        thinkSelector.onSelect = (item) => {
          void (async () => {
            try {
              const result = await client.patchSession({
                key: state.currentSessionKey,
                thinkingLevel: item.value,
              });
              chatLog.addSystem(`thinking set to ${item.value}`);
              applySessionInfoFromPatch(result);
              await refreshSessionInfo();
            } catch (err) {
              chatLog.addSystem(`think failed: ${String(err)}`);
            }
            ctx.closeOverlay();
            tui.requestRender();
          })();
        };
        thinkSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(thinkSelector);
        tui.requestRender();
        return true;
      }
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          thinkingLevel: args,
        });
        chatLog.addSystem(`thinking set to ${args}`);
        applySessionInfoFromPatch(result);
        await refreshSessionInfo();
      } catch (err) {
        chatLog.addSystem(`think failed: ${String(err)}`);
      }
      return true;
    case "verbose": {
      if (!args) {
        const verboseOpts = ["on", "off"];
        const currentVerbose = state.sessionInfo.verboseLevel ?? "off";
        const verboseItems = verboseOpts.map((v) => ({
          value: v,
          label: v === currentVerbose ? `${v} (current)` : v,
        }));
        const verboseSelector = createSelectList(verboseItems, verboseItems.length);
        verboseSelector.onSelect = (item) => {
          void (async () => {
            try {
              const result = await client.patchSession({
                key: state.currentSessionKey,
                verboseLevel: item.value,
              });
              chatLog.addSystem(`verbose set to ${item.value}`);
              applySessionInfoFromPatch(result);
              await loadHistory();
            } catch (err) {
              chatLog.addSystem(`verbose failed: ${String(err)}`);
            }
            ctx.closeOverlay();
            tui.requestRender();
          })();
        };
        verboseSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(verboseSelector);
        tui.requestRender();
        return true;
      }
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          verboseLevel: args,
        });
        chatLog.addSystem(`verbose set to ${args}`);
        applySessionInfoFromPatch(result);
        await loadHistory();
      } catch (err) {
        chatLog.addSystem(`verbose failed: ${String(err)}`);
      }
      return true;
    }
    case "reasoning": {
      if (!args) {
        const reasoningOpts = ["on", "off"];
        const currentReasoning = state.sessionInfo.reasoningLevel ?? "off";
        const reasoningItems = reasoningOpts.map((r) => ({
          value: r,
          label: r === currentReasoning ? `${r} (current)` : r,
        }));
        const reasoningSelector = createSelectList(reasoningItems, reasoningItems.length);
        reasoningSelector.onSelect = (item) => {
          void (async () => {
            try {
              const result = await client.patchSession({
                key: state.currentSessionKey,
                reasoningLevel: item.value,
              });
              chatLog.addSystem(`reasoning set to ${item.value}`);
              applySessionInfoFromPatch(result);
              await refreshSessionInfo();
            } catch (err) {
              chatLog.addSystem(`reasoning failed: ${String(err)}`);
            }
            ctx.closeOverlay();
            tui.requestRender();
          })();
        };
        reasoningSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(reasoningSelector);
        tui.requestRender();
        return true;
      }
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          reasoningLevel: args,
        });
        chatLog.addSystem(`reasoning set to ${args}`);
        applySessionInfoFromPatch(result);
        await refreshSessionInfo();
      } catch (err) {
        chatLog.addSystem(`reasoning failed: ${String(err)}`);
      }
      return true;
    }
    case "usage": {
      const normalized = args ? normalizeUsageDisplay(args) : undefined;
      if (args && !normalized) {
        chatLog.addSystem("usage: /usage <off|tokens|full>");
        return true;
      }
      const currentRaw = state.sessionInfo.responseUsage;
      const current = resolveResponseUsageMode(currentRaw);
      const next =
        normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          responseUsage: next === "off" ? null : next,
        });
        chatLog.addSystem(`usage footer: ${next}`);
        applySessionInfoFromPatch(result);
        await refreshSessionInfo();
      } catch (err) {
        chatLog.addSystem(`usage failed: ${String(err)}`);
      }
      return true;
    }
    case "elevated": {
      if (!args) {
        const elevatedOpts = ["on", "off", "ask", "full"];
        const currentElevated = state.sessionInfo.elevatedLevel ?? "off";
        const elevatedItems = elevatedOpts.map((e) => ({
          value: e,
          label: e === currentElevated ? `${e} (current)` : e,
        }));
        const elevatedSelector = createSelectList(elevatedItems, elevatedItems.length);
        elevatedSelector.onSelect = (item) => {
          void (async () => {
            try {
              const result = await client.patchSession({
                key: state.currentSessionKey,
                elevatedLevel: item.value,
              });
              chatLog.addSystem(`elevated set to ${item.value}`);
              applySessionInfoFromPatch(result);
              await refreshSessionInfo();
            } catch (err) {
              chatLog.addSystem(`elevated failed: ${String(err)}`);
            }
            ctx.closeOverlay();
            tui.requestRender();
          })();
        };
        elevatedSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(elevatedSelector);
        tui.requestRender();
        return true;
      }
      if (!["on", "off", "ask", "full"].includes(args)) {
        chatLog.addSystem("usage: /elevated <on|off|ask|full>");
        return true;
      }
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          elevatedLevel: args,
        });
        chatLog.addSystem(`elevated set to ${args}`);
        applySessionInfoFromPatch(result);
        await refreshSessionInfo();
      } catch (err) {
        chatLog.addSystem(`elevated failed: ${String(err)}`);
      }
      return true;
    }
    case "activation": {
      if (!args) {
        const activationOpts = ["mention", "always"];
        const currentActivation = state.sessionInfo.groupActivation ?? "mention";
        const activationItems = activationOpts.map((a) => ({
          value: a,
          label: a === currentActivation ? `${a} (current)` : a,
        }));
        const activationSelector = createSelectList(activationItems, activationItems.length);
        activationSelector.onSelect = (item) => {
          void (async () => {
            try {
              const result = await client.patchSession({
                key: state.currentSessionKey,
                groupActivation: item.value === "always" ? "always" : "mention",
              });
              chatLog.addSystem(`activation set to ${item.value}`);
              applySessionInfoFromPatch(result);
              await refreshSessionInfo();
            } catch (err) {
              chatLog.addSystem(`activation failed: ${String(err)}`);
            }
            ctx.closeOverlay();
            tui.requestRender();
          })();
        };
        activationSelector.onCancel = () => {
          ctx.closeOverlay();
          tui.requestRender();
        };
        ctx.openOverlay(activationSelector);
        tui.requestRender();
        return true;
      }
      try {
        const result = await client.patchSession({
          key: state.currentSessionKey,
          groupActivation: args === "always" ? "always" : "mention",
        });
        chatLog.addSystem(`activation set to ${args}`);
        applySessionInfoFromPatch(result);
        await refreshSessionInfo();
      } catch (err) {
        chatLog.addSystem(`activation failed: ${String(err)}`);
      }
      return true;
    }
    case "context": {
      const used = state.sessionInfo.totalTokens ?? 0;
      const max = state.sessionInfo.contextTokens ?? 0;
      const lines = formatContextVisualization({
        usedTokens: used,
        maxTokens: max,
        inputTokens: state.sessionInfo.inputTokens,
        outputTokens: state.sessionInfo.outputTokens,
      });
      for (const line of lines) {
        chatLog.addSystem(line);
      }
      return true;
    }
    default:
      return false;
  }
};
