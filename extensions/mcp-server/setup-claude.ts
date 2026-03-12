/**
 * Auto-configure Claude Code to use Mayros MCP server.
 *
 * Registers Mayros as an MCP server in Claude Code's config.
 * Supports both stdio (Claude manages process) and HTTP (pre-running server) modes.
 */

export async function setupClaudeCodeMcp(opts: {
  port: number;
  host: string;
  transport?: "stdio" | "http";
}): Promise<void> {
  const { execSync } = await import("node:child_process");
  const transport = opts.transport ?? "stdio";

  try {
    if (transport === "stdio") {
      // Claude Code spawns and manages the process via stdio
      execSync("claude mcp add mayros -- mayros serve --stdio", { stdio: "inherit" });
    } else {
      // Connect to a pre-running HTTP server
      const url = `http://${opts.host}:${opts.port}/mcp`;
      execSync(`claude mcp add mayros -s http --url ${url}`, { stdio: "inherit" });
    }
    console.log("Mayros MCP server registered with Claude Code.");
  } catch {
    // Fallback: show manual instructions
    console.log("\nTo connect Mayros to Claude Code, run one of:\n");
    console.log("  # Option 1: stdio (Claude manages the process)");
    console.log("  claude mcp add mayros -- mayros serve --stdio\n");
    console.log("  # Option 2: HTTP (connect to running server)");
    console.log(`  mayros serve --http --port ${opts.port} --host ${opts.host}`);
    console.log(`  claude mcp add mayros -s http --url http://${opts.host}:${opts.port}/mcp\n`);
  }
}
