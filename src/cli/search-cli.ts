/**
 * Session Search CLI — search conversation history across sessions.
 */

import type { Command } from "commander";
import { searchSessions } from "../infra/session-search.js";

export function registerSearchCli(program: Command) {
  const search = program
    .command("search")
    .description("Search conversation history across sessions");

  search
    .argument("<query>", "Search query (case-insensitive)")
    .option("--role <role>", "Filter by role: user or assistant")
    .option("--since <date>", "Only messages after this date (ISO 8601 or YYYY-MM-DD)")
    .option("--before <date>", "Only messages before this date")
    .option("--limit <n>", "Max results (default: 20)", "20")
    .option("--session <id>", "Search specific session ID")
    .action(async (query: string, opts: Record<string, string | undefined>) => {
      const limit = parseInt(opts.limit ?? "20", 10);
      const since = opts.since ? new Date(opts.since).getTime() : undefined;
      const before = opts.before ? new Date(opts.before).getTime() : undefined;
      const role = opts.role as "user" | "assistant" | undefined;
      const sessionIds = opts.session ? [opts.session] : undefined;

      const summary = await searchSessions({
        query,
        role,
        since,
        before,
        limit: Number.isFinite(limit) ? limit : 20,
        sessionIds,
      });

      if (summary.results.length === 0) {
        console.log(
          `No results found for "${query}" (searched ${summary.sessionsSearched} sessions in ${summary.durationMs}ms)`,
        );
        return;
      }

      console.log(
        `Found ${summary.totalMatches} result(s) in ${summary.sessionsSearched} sessions (${summary.durationMs}ms)\n`,
      );

      for (const result of summary.results) {
        const date = new Date(result.timestamp).toISOString().slice(0, 16).replace("T", " ");
        const roleTag = result.role === "user" ? "[You]" : "[AI]";
        console.log(`${date} ${roleTag} (session: ${result.sessionId})`);
        console.log(`  ${result.snippet.replace(/\n/g, " ").slice(0, 120)}`);
        console.log();
      }
    });
}
