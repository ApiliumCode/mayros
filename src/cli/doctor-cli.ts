/**
 * `mayros doctor` — Diagnostic CLI.
 *
 * Aggregates runtime, Cortex, plugins, security, and config checks
 * into a single diagnostic report.
 *
 * Subcommands:
 *   runtime    — Node.js version, pnpm availability
 *   cortex     — Cortex health, version, stats
 *   plugins    — Plugin load status, diagnostics
 *   security   — Security audit findings
 *   config     — Config validation
 */

import { execSync } from "node:child_process";
import type { Command } from "commander";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { REQUIRED_CORTEX_VERSION } from "../../extensions/shared/cortex-version.js";
import { resolveCortexClient } from "./shared/cortex-resolution.js";
import { detectRuntime, runtimeSatisfies, parseSemver, isAtLeast } from "../infra/runtime-guard.js";
import { loadConfig } from "../config/config.js";
import { buildPluginStatusReport } from "../plugins/status.js";
import { runSecurityAudit } from "../security/audit.js";

// ============================================================================
// Types
// ============================================================================

export type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  summary: { pass: number; warn: number; fail: number };
};

// ============================================================================
// Helpers
// ============================================================================

function summarize(checks: DoctorCheck[]): DoctorReport["summary"] {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.status === "pass") pass++;
    else if (c.status === "warn") warn++;
    else fail++;
  }
  return { pass, warn, fail };
}

function statusIcon(status: "pass" | "warn" | "fail"): string {
  switch (status) {
    case "pass":
      return "\x1b[32m✓ PASS\x1b[0m";
    case "warn":
      return "\x1b[33m⚠ WARN\x1b[0m";
    case "fail":
      return "\x1b[31m✗ FAIL\x1b[0m";
  }
}

function printChecks(checks: DoctorCheck[], json: boolean): void {
  if (json) {
    const report: DoctorReport = { checks, summary: summarize(checks) };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const c of checks) {
    console.log(`  ${statusIcon(c.status)}  ${c.name}: ${c.message}`);
    if (c.detail) {
      console.log(`         ${c.detail}`);
    }
  }

  const summary = summarize(checks);
  console.log(
    `\n  Summary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failures`,
  );
}

// ============================================================================
// Check: Runtime
// ============================================================================

function checkRuntime(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const runtime = detectRuntime();
  const satisfied = runtimeSatisfies(runtime);

  checks.push({
    name: "Node.js version",
    status: satisfied ? "pass" : "fail",
    message: satisfied
      ? `Node ${runtime.version} (>= 22.12.0)`
      : `Node ${runtime.version ?? "unknown"} — requires >= 22.12.0`,
  });

  try {
    const pnpmVersion = execSync("pnpm --version", { encoding: "utf8", timeout: 5000 }).trim();
    checks.push({
      name: "pnpm",
      status: "pass",
      message: `pnpm ${pnpmVersion} available`,
    });
  } catch {
    checks.push({
      name: "pnpm",
      status: "warn",
      message: "pnpm not found in PATH",
      detail: "Install: npm install -g pnpm",
    });
  }

  return checks;
}

// ============================================================================
// Check: Cortex
// ============================================================================

async function checkCortex(opts: {
  host?: string;
  port?: string;
  token?: string;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const client = resolveCortexClient(opts, { pluginName: ["memory-semantic", "agent-mesh"] });

  const healthy = await client.isHealthy();
  if (!healthy) {
    checks.push({
      name: "Cortex health",
      status: "fail",
      message: `Cortex unreachable at ${client.baseUrl}`,
      detail: "Start Cortex or check host/port configuration",
    });
    client.destroy();
    return checks;
  }

  checks.push({
    name: "Cortex health",
    status: "pass",
    message: `Cortex healthy at ${client.baseUrl}`,
  });

  // Version check
  try {
    const health = await client.health();
    const version = health.version;
    if (version) {
      const required = parseSemver(REQUIRED_CORTEX_VERSION);
      const current = parseSemver(version);
      const versionOk = required && isAtLeast(current, required);

      checks.push({
        name: "Cortex version",
        status: versionOk ? "pass" : "warn",
        message: versionOk
          ? `Cortex ${version} (>= ${REQUIRED_CORTEX_VERSION})`
          : `Cortex ${version} — requires >= ${REQUIRED_CORTEX_VERSION}`,
      });
    }
  } catch {
    checks.push({
      name: "Cortex version",
      status: "warn",
      message: "Could not determine Cortex version",
    });
  }

  // Stats
  try {
    const stats = await client.stats();
    checks.push({
      name: "Cortex stats",
      status: "pass",
      message: `${stats.graph.triple_count} triples, ${stats.graph.subject_count} subjects`,
      detail: `Uptime: ${Math.floor(stats.server.uptime_seconds)}s, clients: ${stats.server.connected_clients}`,
    });
  } catch {
    checks.push({
      name: "Cortex stats",
      status: "warn",
      message: "Could not retrieve Cortex stats",
    });
  }

  client.destroy();
  return checks;
}

// ============================================================================
// Check: Plugins
// ============================================================================

function checkPlugins(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  try {
    const report = buildPluginStatusReport();
    const loaded = report.plugins?.length ?? 0;
    const diagnostics = report.diagnostics ?? [];
    const errorDiags = diagnostics.filter((d) => d.level === "error");

    if (errorDiags.length > 0) {
      checks.push({
        name: "Plugin loading",
        status: "fail",
        message: `${loaded} plugins loaded, ${errorDiags.length} error(s)`,
        detail: errorDiags
          .slice(0, 3)
          .map((e: { message: string }) => e.message)
          .join("; "),
      });
    } else {
      checks.push({
        name: "Plugin loading",
        status: "pass",
        message: `${loaded} plugins loaded`,
      });
    }

    const warnDiags = diagnostics.filter((d) => d.level === "warn" || d.level === "error");
    if (warnDiags.length > 0) {
      checks.push({
        name: "Plugin diagnostics",
        status: "warn",
        message: `${warnDiags.length} diagnostic warning(s)`,
        detail: warnDiags
          .slice(0, 3)
          .map((d) => `[${d.pluginId}] ${d.message}`)
          .join("; "),
      });
    }
  } catch (err) {
    checks.push({
      name: "Plugin loading",
      status: "fail",
      message: `Failed to load plugins: ${String(err)}`,
    });
  }

  return checks;
}

// ============================================================================
// Check: Security
// ============================================================================

async function checkSecurity(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  try {
    const cfg = loadConfig();
    const report = await runSecurityAudit({
      config: cfg,
      deep: false,
      includeFilesystem: false,
      includeChannelSecurity: false,
    });

    const { critical, warn: warnCount } = report.summary;

    if (critical > 0) {
      checks.push({
        name: "Security audit",
        status: "fail",
        message: `${critical} critical finding(s), ${warnCount} warning(s)`,
        detail: report.findings
          .filter((f) => f.severity === "critical")
          .slice(0, 3)
          .map((f) => f.title)
          .join("; "),
      });
    } else if (warnCount > 0) {
      checks.push({
        name: "Security audit",
        status: "warn",
        message: `${warnCount} warning(s), 0 critical`,
      });
    } else {
      checks.push({
        name: "Security audit",
        status: "pass",
        message: "No critical or warning findings",
      });
    }
  } catch (err) {
    checks.push({
      name: "Security audit",
      status: "warn",
      message: `Could not run security audit: ${String(err)}`,
    });
  }

  return checks;
}

// ============================================================================
// Check: Config
// ============================================================================

function checkConfig(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  try {
    const cfg = loadConfig();
    checks.push({
      name: "Config loaded",
      status: "pass",
      message: "Configuration loaded successfully",
    });

    // Check cortex config
    if (cfg.plugins?.entries) {
      const pluginNames = Object.keys(cfg.plugins.entries);
      checks.push({
        name: "Plugin entries",
        status: "pass",
        message: `${pluginNames.length} plugin(s) configured`,
      });
    }
  } catch (err) {
    checks.push({
      name: "Config loaded",
      status: "fail",
      message: `Config error: ${String(err)}`,
    });
  }

  return checks;
}

// ============================================================================
// Registration
// ============================================================================

export function registerDoctorCli(program: Command) {
  const doc = program
    .command("diagnose")
    .description("Diagnostic checks — runtime, Cortex, plugins, security, config")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)")
    .option("--json", "Output as JSON");

  // Default: run all checks
  doc.action(async (opts) => {
    const json = opts.json === true;
    const checks: DoctorCheck[] = [];

    if (!json) {
      console.log("Mayros Doctor\n");
      console.log("  Runtime:");
    }
    const runtimeChecks = checkRuntime();
    checks.push(...runtimeChecks);
    if (!json) printChecks(runtimeChecks, false);

    if (!json) console.log("\n  Cortex:");
    const cortexChecks = await checkCortex({
      host: opts.cortexHost,
      port: opts.cortexPort,
      token: opts.cortexToken,
    });
    checks.push(...cortexChecks);
    if (!json) printChecks(cortexChecks, false);

    if (!json) console.log("\n  Plugins:");
    const pluginChecks = checkPlugins();
    checks.push(...pluginChecks);
    if (!json) printChecks(pluginChecks, false);

    if (!json) console.log("\n  Security:");
    const securityChecks = await checkSecurity();
    checks.push(...securityChecks);
    if (!json) printChecks(securityChecks, false);

    if (!json) console.log("\n  Config:");
    const configChecks = checkConfig();
    checks.push(...configChecks);
    if (!json) printChecks(configChecks, false);

    if (json) {
      const report: DoctorReport = { checks, summary: summarize(checks) };
      console.log(JSON.stringify(report, null, 2));
    } else {
      const summary = summarize(checks);
      console.log(
        `\n  Overall: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failures`,
      );
    }
  });

  // Subcommand: runtime
  doc
    .command("runtime")
    .description("Check Node.js version and pnpm availability")
    .option("--json", "Output as JSON")
    .action((opts) => {
      printChecks(checkRuntime(), opts.json === true);
    });

  // Subcommand: cortex
  doc
    .command("cortex")
    .description("Check Cortex health, version, and stats")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const checks = await checkCortex({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      printChecks(checks, opts.json === true);
    });

  // Subcommand: plugins
  doc
    .command("plugins")
    .description("Check plugin load status and diagnostics")
    .option("--json", "Output as JSON")
    .action((opts) => {
      printChecks(checkPlugins(), opts.json === true);
    });

  // Subcommand: security
  doc
    .command("security")
    .description("Run security audit checks")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      printChecks(await checkSecurity(), opts.json === true);
    });

  // Subcommand: config
  doc
    .command("config")
    .description("Validate configuration")
    .option("--json", "Output as JSON")
    .action((opts) => {
      printChecks(checkConfig(), opts.json === true);
    });
}
