/**
 * CLI registration for the `mayros migrate` command.
 * Provides run, status, and verify subcommands.
 */

import type { CortexClient } from "../cortex-client.js";
import type { TitansClient } from "../titans-client.js";
import { Migrator, type MigrationReport } from "./migrator.js";

export type MigrateCliOptions = {
  cortex: CortexClient;
  titans: TitansClient | null;
  ns: string;
  agentId: string;
  workspaceDir: string;
};

/**
 * Register CLI commands under the given Commander program.
 * Called from the main plugin's registerCli().
 */
export function registerMigrateCli(
  // oxlint-disable-next-line typescript/no-explicit-any
  program: any,
  opts: MigrateCliOptions,
): void {
  const migrator = new Migrator(opts.cortex, opts.titans, opts.ns);

  const migrate = program
    .command("migrate")
    .description("Migrate markdown memory to semantic graph");

  migrate
    .command("run")
    .description("Run the full migration pipeline")
    .option("--agent <id>", "Agent ID", opts.agentId)
    .option("--dry-run", "Preview without writing", false)
    .option("--include-history", "Include session .jsonl history", false)
    .option("--verbose", "Show detailed progress", false)
    .action(
      async (cmdOpts: {
        agent: string;
        dryRun: boolean;
        includeHistory: boolean;
        verbose: boolean;
      }) => {
        console.log(cmdOpts.dryRun ? "Migration DRY RUN..." : "Starting migration...");

        const report = await migrator.run({
          agentId: cmdOpts.agent,
          workspaceDir: opts.workspaceDir,
          dryRun: cmdOpts.dryRun,
          includeHistory: cmdOpts.includeHistory,
          verbose: cmdOpts.verbose,
        });

        printReport(report);
      },
    );

  migrate
    .command("status")
    .description("Show migration and graph status")
    .option("--agent <id>", "Agent ID", opts.agentId)
    .option("--json", "Output as JSON", false)
    .action(async (cmdOpts: { agent: string; json: boolean }) => {
      const status = await migrator.status(cmdOpts.agent);

      if (cmdOpts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(`Cortex: ${status.cortexOnline ? "ONLINE" : "OFFLINE"}`);
      console.log(`Total triples: ${status.tripleCount}`);
      console.log(`Agent memories: ${status.memoryCount}`);
      console.log(`Identity triples: ${status.identityTriples}`);
    });

  migrate
    .command("verify")
    .description("Verify migration integrity")
    .option("--agent <id>", "Agent ID", opts.agentId)
    .action(async (cmdOpts: { agent: string }) => {
      console.log("Verifying migration...");

      const result = await migrator.verify(cmdOpts.agent);

      console.log(`Valid: ${result.valid ? "YES" : "NO"}`);
      console.log(`Memory count: ${result.memoryCount}`);
      console.log(`Identity triples: ${result.identityCount}`);

      if (result.issues.length > 0) {
        console.log("\nIssues:");
        for (const issue of result.issues) {
          console.log(`  - ${issue}`);
        }
      }
    });
}

// ============================================================================
// Report formatting
// ============================================================================

function printReport(report: MigrationReport): void {
  console.log("\n=== Migration Report ===");
  console.log(`Status: ${report.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Duration: ${report.duration}ms`);
  console.log(`Total triples: ${report.totalTriples}`);
  console.log(`Total memories: ${report.totalMemories}`);

  console.log("\nSteps:");
  for (const step of report.steps) {
    const icon =
      step.status === "done"
        ? "[OK]"
        : step.status === "skipped"
          ? "[--]"
          : step.status === "failed"
            ? "[!!]"
            : "[..]";
    console.log(`  ${icon} ${step.name}: ${step.count} items (${step.status})`);
    for (const err of step.errors) {
      console.log(`       Error: ${err}`);
    }
  }

  if (report.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of report.warnings) {
      console.log(`  - ${w}`);
    }
  }
}
