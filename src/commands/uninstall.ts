import { execFileSync } from "node:child_process";
import path from "node:path";
import { homedir } from "node:os";
import { cancel, confirm, isCancel, multiselect } from "@clack/prompts";
import { isNixMode } from "../config/config.js";
import { resolveGatewayService } from "../daemon/service.js";
import type { RuntimeEnv } from "../runtime.js";
import { stylePromptHint, stylePromptMessage, stylePromptTitle } from "../terminal/prompt-style.js";
import { resolveHomeDir } from "../utils.js";
import { resolveCleanupPlanFromDisk } from "./cleanup-plan.js";
import { removePath } from "./cleanup-utils.js";

type UninstallScope = "service" | "state" | "workspace" | "app" | "cortex";

export type UninstallOptions = {
  service?: boolean;
  state?: boolean;
  workspace?: boolean;
  app?: boolean;
  cortex?: boolean;
  all?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
};

const multiselectStyled = <T>(params: Parameters<typeof multiselect<T>>[0]) =>
  multiselect({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) =>
      opt.hint === undefined ? opt : { ...opt, hint: stylePromptHint(opt.hint) },
    ),
  });

function buildScopeSelection(opts: UninstallOptions): {
  scopes: Set<UninstallScope>;
  hadExplicit: boolean;
} {
  const hadExplicit = Boolean(opts.all || opts.service || opts.state || opts.workspace || opts.app);
  const scopes = new Set<UninstallScope>();
  if (opts.all || opts.service) {
    scopes.add("service");
  }
  if (opts.all || opts.state) {
    scopes.add("state");
  }
  if (opts.all || opts.workspace) {
    scopes.add("workspace");
  }
  if (opts.all || opts.app) {
    scopes.add("app");
  }
  if (opts.all || opts.cortex) {
    scopes.add("cortex");
  }
  return { scopes, hadExplicit };
}

async function stopAndUninstallService(runtime: RuntimeEnv): Promise<boolean> {
  if (isNixMode) {
    runtime.error("Nix mode detected; service uninstall is disabled.");
    return false;
  }
  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    runtime.error(`Gateway service check failed: ${String(err)}`);
    return false;
  }
  if (!loaded) {
    runtime.log(`Gateway service ${service.notLoadedText}.`);
    return true;
  }
  try {
    await service.stop({ env: process.env, stdout: process.stdout });
  } catch (err) {
    runtime.error(`Gateway stop failed: ${String(err)}`);
  }
  try {
    await service.uninstall({ env: process.env, stdout: process.stdout });
    return true;
  } catch (err) {
    runtime.error(`Gateway uninstall failed: ${String(err)}`);
    return false;
  }
}

async function removeMacApp(runtime: RuntimeEnv, dryRun?: boolean) {
  if (process.platform !== "darwin") {
    return;
  }
  await removePath("/Applications/Mayros.app", runtime, {
    dryRun,
    label: "/Applications/Mayros.app",
  });
}

export async function uninstallCommand(runtime: RuntimeEnv, opts: UninstallOptions) {
  const { scopes, hadExplicit } = buildScopeSelection(opts);
  const interactive = !opts.nonInteractive;
  if (!interactive && !opts.yes) {
    runtime.error("Non-interactive mode requires --yes.");
    runtime.exit(1);
    return;
  }

  if (!hadExplicit) {
    if (!interactive) {
      runtime.error("Non-interactive mode requires explicit scopes (use --all).");
      runtime.exit(1);
      return;
    }
    const selection = await multiselectStyled<UninstallScope>({
      message: "Uninstall which components?",
      options: [
        {
          value: "service",
          label: "Gateway service",
          hint: "launchd / systemd / schtasks",
        },
        { value: "state", label: "State + config", hint: "~/.mayros" },
        { value: "workspace", label: "Workspace", hint: "agent files" },
        {
          value: "app",
          label: "macOS app",
          hint: "/Applications/Mayros.app",
        },
        {
          value: "cortex",
          label: "Cortex (AIngle)",
          hint: "binary + graph database",
        },
      ],
      initialValues: ["service", "state", "workspace"],
    });
    if (isCancel(selection)) {
      cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
      runtime.exit(0);
      return;
    }
    for (const value of selection) {
      scopes.add(value);
    }
  }

  if (scopes.size === 0) {
    runtime.log("Nothing selected.");
    return;
  }

  // Always show what will be lost — even with --yes
  const warnings: string[] = [];
  if (scopes.has("service")) warnings.push("Gateway service (background daemon)");
  if (scopes.has("state")) {
    warnings.push("Configuration and credentials (~/.mayros)");
    warnings.push("  - API keys and OAuth tokens");
    warnings.push("  - Channel configurations (WhatsApp, Telegram, etc.)");
    warnings.push("  - Session history and agent settings");
  }
  if (scopes.has("workspace")) {
    warnings.push("Agent workspaces");
    warnings.push("  - Custom agents (*.md files)");
    warnings.push("  - Installed skills and commands");
    warnings.push("  - AGENTS.md, SOUL.md, TOOLS.md persona files");
  }
  if (scopes.has("app")) warnings.push("macOS desktop application (/Applications/Mayros.app)");
  if (scopes.has("cortex")) {
    warnings.push("AIngle Cortex — ALL semantic data will be destroyed:");
    warnings.push("  - Knowledge graph (every triple, every namespace)");
    warnings.push("  - Ventures, missions, projects, directives");
    warnings.push("  - Agent learning profiles and expertise history");
    warnings.push("  - Decision history (consensus votes and reasoning)");
    warnings.push("  - Semantic memory (STM/LTM, embeddings, recall data)");
    warnings.push("  - DAG audit trail (all signed actions, time-travel history)");
    warnings.push("  - Fuel events and cost tracking data");
    warnings.push("  - Knowledge transfer and fusion records");
  }

  runtime.log("");
  runtime.log("========================================");
  runtime.log("  MAYROS UNINSTALL — DATA LOSS WARNING");
  runtime.log("========================================");
  runtime.log("");
  runtime.log("The following will be PERMANENTLY DELETED:");
  runtime.log("");
  for (const w of warnings) {
    runtime.log(`  ${w}`);
  }
  runtime.log("");
  runtime.log("This action CANNOT be undone. There is no backup.");
  runtime.log("All your agent memory, learned expertise, ventures,");
  runtime.log("missions, and decision history will be lost forever.");
  runtime.log("");

  if (interactive && !opts.yes) {
    const ok = await confirm({
      message: stylePromptMessage("I understand the data loss. Proceed with uninstall?"),
    });
    if (isCancel(ok) || !ok) {
      cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
      runtime.exit(0);
      return;
    }
  }

  const dryRun = Boolean(opts.dryRun);
  const { stateDir, configPath, oauthDir, configInsideState, oauthInsideState, workspaceDirs } =
    resolveCleanupPlanFromDisk();

  if (scopes.has("service")) {
    if (dryRun) {
      runtime.log("[dry-run] remove gateway service");
    } else {
      await stopAndUninstallService(runtime);
    }
  }

  if (scopes.has("state")) {
    await removePath(stateDir, runtime, { dryRun, label: stateDir });
    if (!configInsideState) {
      await removePath(configPath, runtime, { dryRun, label: configPath });
    }
    if (!oauthInsideState) {
      await removePath(oauthDir, runtime, { dryRun, label: oauthDir });
    }
  }

  if (scopes.has("workspace")) {
    for (const workspace of workspaceDirs) {
      await removePath(workspace, runtime, { dryRun, label: workspace });
    }
  }

  if (scopes.has("app")) {
    await removeMacApp(runtime, dryRun);
  }

  if (scopes.has("cortex")) {
    // Stop running Cortex process
    if (!dryRun) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/F", "/IM", "aingle-cortex.exe"], { timeout: 5000 });
        } else {
          execFileSync("pkill", ["-f", "aingle-cortex"], { timeout: 5000 });
        }
        runtime.log("Stopped Cortex process.");
      } catch {
        // Not running — that's fine
      }
    } else {
      runtime.log("[dry-run] stop Cortex process");
    }

    // Remove Cortex binary
    const cortexBinDir = path.join(homedir(), ".mayros", "bin");
    await removePath(cortexBinDir, runtime, { dryRun, label: cortexBinDir });

    // Remove Cortex data (graph database, DAG, proofs)
    const cortexDataDir = path.join(homedir(), ".aingle", "cortex");
    await removePath(cortexDataDir, runtime, { dryRun, label: cortexDataDir });
  }

  runtime.log("CLI still installed. Remove via npm/pnpm if desired.");

  if (scopes.has("state") && !scopes.has("workspace")) {
    const home = resolveHomeDir();
    if (home && workspaceDirs.some((dir) => dir.startsWith(path.resolve(home)))) {
      runtime.log("Tip: workspaces were preserved. Re-run with --workspace to remove them.");
    }
  }
}
