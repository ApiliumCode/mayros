/**
 * Session/model/search command group.
 * Commands: agent, agents, session, sessions, model, models, new, reset, search
 */

import { SessionManager, formatSessionLine } from "./session-manager.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const sessionCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const { client, chatLog, state, refreshSessionInfo, loadHistory, setSession, formatSessionKey } =
    ctx;

  switch (name) {
    case "agent":
    case "agents":
      if (!args) {
        await ctx.openAgentSelector();
      } else {
        await ctx.setAgent(args);
      }
      return true;
    case "session":
    case "sessions": {
      const sessionSubCmd = args.split(/\s+/)[0]?.toLowerCase();
      const sessionArgs = args.slice((sessionSubCmd ?? "").length).trim();

      if (!args) {
        await ctx.openSessionSelector();
      } else if (sessionSubCmd === "list") {
        try {
          const mgr = new SessionManager({
            client,
            currentAgentId: state.currentAgentId,
          });
          const sessions = await mgr.listSessions({ limit: 20 });
          if (sessions.length === 0) {
            chatLog.addSystem("no sessions found");
          } else {
            const lines = sessions.map((s) => formatSessionLine(s, formatSessionKey));
            chatLog.addSystem(
              `Sessions (${sessions.length}):\n${lines.map((l) => `  ${l}`).join("\n")}`,
            );
          }
        } catch (err) {
          chatLog.addSystem(`session list failed: ${String(err)}`);
        }
      } else if (sessionSubCmd === "rename") {
        if (!sessionArgs) {
          chatLog.addSystem("usage: /session rename <name>");
        } else {
          try {
            const mgr = new SessionManager({
              client,
              currentAgentId: state.currentAgentId,
            });
            await mgr.renameSession(state.currentSessionKey, sessionArgs);
            chatLog.addSystem(`session renamed to "${sessionArgs}"`);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`session rename failed: ${String(err)}`);
          }
        }
      } else if (sessionSubCmd === "delete") {
        if (!sessionArgs) {
          chatLog.addSystem("usage: /session delete <key>");
        } else {
          try {
            const mgr = new SessionManager({
              client,
              currentAgentId: state.currentAgentId,
            });
            await mgr.deleteSession(sessionArgs);
            chatLog.addSystem(`session ${sessionArgs} deleted`);
          } catch (err) {
            chatLog.addSystem(`session delete failed: ${String(err)}`);
          }
        }
      } else {
        // Treat as session key for resume
        await setSession(args);
      }
      return true;
    }
    case "model":
    case "models":
      if (!args) {
        await ctx.openModelSelector();
      } else {
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            model: args,
          });
          chatLog.addSystem(`model set to ${args}`);
          ctx.applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`model set failed: ${String(err)}`);
        }
      }
      return true;
    case "new":
    case "reset":
      try {
        // Clear token counts immediately to avoid stale display (#1523)
        state.sessionInfo.inputTokens = null;
        state.sessionInfo.outputTokens = null;
        state.sessionInfo.totalTokens = null;
        ctx.tui.requestRender();

        await client.resetSession(state.currentSessionKey, name);
        chatLog.addSystem(`session ${state.currentSessionKey} reset`);
        await loadHistory();
      } catch (err) {
        chatLog.addSystem(`reset failed: ${String(err)}`);
      }
      return true;
    case "search": {
      const query = args.trim();
      if (!query) {
        chatLog.addSystem("Usage: /search <query>");
        return true;
      }
      chatLog.addSystem(`Searching for "${query}"...`);
      try {
        const { searchSessions } = await import("../infra/session-search.js");
        const summary = await searchSessions({ query, limit: 10 });
        if (summary.results.length === 0) {
          chatLog.addSystem(
            `No results found for "${query}" (${summary.sessionsSearched} sessions searched)`,
          );
          return true;
        }
        const lines = [
          `Found ${summary.totalMatches} result(s) in ${summary.sessionsSearched} sessions:`,
        ];
        for (const r of summary.results) {
          const date = new Date(r.timestamp).toISOString().slice(0, 16).replace("T", " ");
          const tag = r.role === "user" ? "[You]" : "[AI]";
          lines.push(
            `${date} ${tag} (${r.sessionId}): ${r.snippet.replace(/\n/g, " ").slice(0, 100)}`,
          );
        }
        chatLog.addSystem(lines.join("\n"));
      } catch (err) {
        chatLog.addSystem(`search failed: ${String(err)}`);
      }
      return true;
    }
    default:
      return false;
  }
};
