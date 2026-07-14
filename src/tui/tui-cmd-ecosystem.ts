/**
 * Mayros ecosystem command group.
 * Commands: plan, kg, trace, team, tasks, workflow, rules, mailbox, sync, mouse
 */

import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const ecosystemCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const { chatLog } = ctx;

  switch (name) {
    case "plan": {
      const action = args || "show";
      await ctx.sendMessage(`/plan ${action}`);
      return true;
    }
    case "mouse": {
      if (ctx.mouseHandler) {
        if (ctx.mouseHandler.isEnabled()) {
          ctx.mouseHandler.disable();
          chatLog.addSystem("Mouse reporting disabled — text selection enabled.");
        } else {
          ctx.mouseHandler.enable();
          chatLog.addSystem("Mouse reporting enabled.");
        }
      } else {
        chatLog.addSystem("Mouse handler not available.");
      }
      return true;
    }
    case "kg": {
      // Check if semantic memory tools are likely available by asking the gateway
      const kgHint =
        "You MUST use one of these tools (in order of preference): " +
        "memory_stats, semantic_memory_query, semantic_memory_recall. " +
        "If none of these tools are available to you, respond EXACTLY with: " +
        '"[kg] Plugin memory-semantic is not loaded. Run `mayros plugins list` to check."';
      if (!args) {
        await ctx.sendMessage(
          `Show a knowledge graph summary. ${kgHint} Show categories, triple counts, and recent entries.`,
          "/kg",
        );
      } else {
        await ctx.sendMessage(`Search the knowledge graph for: ${args}. ${kgHint}`, `/kg ${args}`);
      }
      return true;
    }
    case "trace": {
      const subCmd = args || "events";
      if (subCmd === "stats") {
        await ctx.sendMessage(
          "Use the trace_stats tool with no arguments to show aggregated observability statistics for the current agent.",
          "/trace stats",
        );
      } else if (subCmd === "explain" && args.includes(" ")) {
        const eventId = args.slice("explain".length).trim();
        await ctx.sendMessage(
          `Use the trace_explain tool with eventId "${eventId}" to trace the causal chain for that event.`,
          `/trace explain ${eventId}`,
        );
      } else {
        await ctx.sendMessage(
          "Use the trace_query tool with no arguments to list recent trace events for the current agent.",
          "/trace events",
        );
      }
      return true;
    }
    case "team": {
      await ctx.sendMessage(
        "Use the mesh_team_dashboard tool with no arguments to show the team dashboard with current agent status and activity.",
        "/team",
      );
      return true;
    }
    case "tasks": {
      await ctx.sendMessage(
        "Use the agent_list_background_tasks tool with no arguments to list all background agent tasks and their current status.",
        "/tasks",
      );
      return true;
    }
    case "workflow": {
      if (!args) {
        await ctx.sendMessage(
          'Use the mesh_run_workflow tool with action "list" to list available workflows and their status.',
          "/workflow",
        );
      } else {
        await ctx.sendMessage(`/workflow ${args}`);
      }
      return true;
    }
    case "rules": {
      if (args) {
        await ctx.sendMessage(
          `Use the semantic_memory_recall tool to search for rules matching: ${args}`,
          `/rules ${args}`,
        );
      } else {
        await ctx.sendMessage(
          'Use the semantic_memory_recall tool with subject pattern "rule:*" to list all active rules.',
          "/rules",
        );
      }
      return true;
    }
    case "mailbox": {
      if (!args) {
        await ctx.sendMessage(
          "Use the agent_check_inbox tool with no arguments to check the inbox for new messages and show unread count.",
          "/mailbox",
        );
      } else {
        await ctx.sendMessage(`/mailbox ${args}`);
      }
      return true;
    }
    case "sync": {
      await ctx.sendMessage(
        "Use the cortex_sync_status tool with no arguments to show Cortex peer sync status and statistics.",
        "/sync",
      );
      return true;
    }
    default:
      return false;
  }
};
