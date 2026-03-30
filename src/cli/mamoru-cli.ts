/**
 * `mayros mamoru` — Mamoru security & protection CLI.
 *
 * Provides access to sandbox status, egress control, inference proxy,
 * API key management, secrets vault, and local model setup.
 *
 * Subcommands:
 *   status                    — Show sandbox, proxy, gate, vault status
 *   egress list               — List active egress rules + pending requests
 *   egress approve <id>       — Approve a pending egress request
 *   egress deny <id>          — Deny a pending egress request
 *   egress preset add <name>  — Add a preset (github, npm, etc.)
 *   egress preset remove <name> — Remove a preset
 *   egress presets            — List available presets
 *   proxy logs                — Show recent inference logs
 *   proxy profiles            — List inference profiles
 *   proxy set <profile>       — Set active inference profile
 *   keys list --agent <id>    — List API keys
 *   keys create --agent <id> --name <n> — Create API key
 *   keys revoke --key <id>    — Revoke a key
 *   vault list                — List secret names
 *   vault store --name <n> --value <v> — Store a secret
 *   vault get --name <n>      — Retrieve a secret
 *   model detect              — Detect GPU
 *   model suggest             — Suggest local models
 *   model test --endpoint <url> --model <m> — Test local model
 */

import type { Command } from "commander";
import { resolveCortexClient, CortexError } from "./shared/cortex-resolution.js";

/** Print a user-friendly error and set exit code. */
function handleError(err: unknown): void {
  if (err instanceof CortexError) {
    if (err.code === "CONNECTION_ERROR") {
      console.error(
        "Cortex is not running. Start it with `mayros cortex start` or check --cortex-host/--cortex-port.",
      );
    } else {
      console.error(`Cortex error (${err.status}): ${err.message}`);
    }
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
}

/** Lazy-load Mamoru stack to avoid heavy imports at CLI parse time. */
async function loadMamoruStack(opts: {
  cortexHost?: string;
  cortexPort?: string;
  cortexToken?: string;
}) {
  const { createMamoruStack } = await import("../../extensions/mamoru/index.js");
  const client = resolveCortexClient({
    host: opts.cortexHost,
    port: opts.cortexPort,
    token: opts.cortexToken,
  });
  const vaultKey = process.env.MAYROS_VAULT_KEY;
  const stack = await createMamoruStack("mayros", {
    client,
    vaultKey,
  });
  return { stack, client };
}

// ============================================================================
// Registration
// ============================================================================

export function registerMamoruCli(program: Command) {
  const mamoru = program
    .command("mamoru")
    .description("Mamoru — security, inference routing, network control, secrets vault")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros mamoru status
  // ------------------------------------------------------------------
  mamoru
    .command("status")
    .description("Show sandbox, proxy, gate, and vault status")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const sandboxStatus = stack.sandbox.getStatus();
        const availability = await stack.sandbox.checkAvailability();
        const activeProfile = stack.proxy.getActiveProfile();
        const logCount = stack.proxy.getLogCount();
        const policy = stack.proxy.getPolicy();
        const egressPolicy = stack.gate.getPolicy();
        const pending = stack.gate.getPendingRequests();

        console.log("Mamoru Status");
        console.log("─".repeat(50));

        console.log("\nSandbox:");
        console.log(`  Status:       ${sandboxStatus}`);
        console.log(`  Landlock:     ${availability.landlock ? "available" : "unavailable"}`);
        console.log(`  Seccomp:      ${availability.seccomp ? "available" : "unavailable"}`);

        console.log("\nEruberu Proxy:");
        console.log(`  Profile:      ${activeProfile ? activeProfile.name : "(none)"}`);
        console.log(`  Log entries:  ${logCount}`);
        console.log(`  Policy:       providers=${policy.allowedProviders.join(",")}`);

        console.log("\nMamoru Gate (Egress):");
        console.log(`  Policy:       ${egressPolicy.defaultAction}`);
        console.log(`  Pending:      ${pending.length} request(s)`);

        console.log("\nVault:");
        console.log(`  Available:    ${stack.vault ? "yes" : "no (set MAYROS_VAULT_KEY)"}`);

        console.log("\nAPI Keys:");
        console.log(`  Available:    ${stack.apiKeys ? "yes" : "no (requires Cortex)"}`);
      } catch (err) {
        handleError(err);
      }
    });

  // ------------------------------------------------------------------
  // mayros mamoru egress
  // ------------------------------------------------------------------
  const egress = mamoru.command("egress").description("Network egress control");

  egress
    .command("list")
    .description("List active egress rules and pending requests")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const egressPolicy = stack.gate.getPolicy();
        const rules = egressPolicy.rules;
        const pending = stack.gate.getPendingRequests();

        console.log("Active Egress Rules:");
        if (rules.length === 0) {
          console.log("  (none)");
        } else {
          for (const rule of rules) {
            console.log(`  ${rule.host}:${rule.port}  [${rule.protocol}]`);
          }
        }

        console.log(`\nPending Requests (${pending.length}):`);
        if (pending.length === 0) {
          console.log("  (none)");
        } else {
          for (const req of pending) {
            console.log(
              `  ${req.id}  ${req.host}:${req.port}  binary=${req.binary ?? "unknown"}  [${req.status}]`,
            );
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  egress
    .command("approve <id>")
    .description("Approve a pending egress request")
    .option("--session-scoped", "Limit approval to current session only")
    .action(async (id: string, opts: { sessionScoped?: boolean }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        stack.gate.approve(id, { sessionScoped: opts.sessionScoped });
        console.log(`Approved egress request: ${id}`);
      } catch (err) {
        handleError(err);
      }
    });

  egress
    .command("deny <id>")
    .description("Deny a pending egress request")
    .action(async (id: string) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        stack.gate.deny(id);
        console.log(`Denied egress request: ${id}`);
      } catch (err) {
        handleError(err);
      }
    });

  // mayros mamoru egress preset
  const preset = egress.command("preset").description("Manage egress presets");

  preset
    .command("add <name>")
    .description("Add a preset (e.g., github, npm, pypi, docker)")
    .action(async (name: string) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        stack.gate.addPreset(name);
        console.log(`Added egress preset: ${name}`);
      } catch (err) {
        handleError(err);
      }
    });

  preset
    .command("remove <name>")
    .description("Remove a preset")
    .action(async (name: string) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        stack.gate.removePreset(name);
        console.log(`Removed egress preset: ${name}`);
      } catch (err) {
        handleError(err);
      }
    });

  egress
    .command("presets")
    .description("List available egress presets")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const presets = stack.gate.listPresets();
        const activePresets = stack.gate.getPolicy().presets;
        console.log("Available Egress Presets:");
        for (const p of presets) {
          const active = activePresets.includes(p.name) ? " [active]" : "";
          console.log(`  ${p.name}${active}  — ${p.description}`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // ------------------------------------------------------------------
  // mayros mamoru proxy
  // ------------------------------------------------------------------
  const proxy = mamoru.command("proxy").description("Inference proxy control");

  proxy
    .command("logs")
    .description("Show recent inference logs")
    .option("--limit <n>", "Number of log entries to show", "20")
    .action(async (opts: { limit: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const limit = parseInt(opts.limit, 10) || 20;
        const logs = stack.proxy.getRecentLogs(limit);
        const summary = stack.proxy.getUsageSummary();

        console.log(`Inference Logs (last ${logs.length}):`);
        for (const log of logs) {
          const ts = new Date(log.timestamp).toISOString();
          console.log(
            `  ${ts}  ${log.model}  ${log.inputTokens}→${log.outputTokens}  ${log.durationMs}ms  [${log.status}]`,
          );
        }

        console.log("\nUsage Summary:");
        console.log(`  Total requests: ${summary.totalRequests}`);
        console.log(`  Total tokens:   ${summary.totalTokens}`);
        console.log(
          `  By provider:    ${
            Object.entries(summary.byProvider)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ") || "none"
          }`,
        );
      } catch (err) {
        handleError(err);
      }
    });

  proxy
    .command("profiles")
    .description("List inference profiles")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const profiles = stack.proxy.listProfiles();
        const activeProfile = stack.proxy.getActiveProfile();

        console.log("Inference Profiles:");
        for (const p of profiles) {
          const marker = activeProfile && p.id === activeProfile.id ? " [active]" : "";
          console.log(`  ${p.name}${marker}  — ${p.providerType} (${p.endpoint})`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  proxy
    .command("set <profile>")
    .description("Set active inference profile")
    .action(async (profile: string) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        stack.proxy.setActiveProfile(profile);
        console.log(`Active inference profile set to: ${profile}`);
      } catch (err) {
        handleError(err);
      }
    });

  // ------------------------------------------------------------------
  // mayros mamoru keys
  // ------------------------------------------------------------------
  const keys = mamoru.command("keys").description("Agent API key management");

  keys
    .command("list")
    .description("List API keys for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (opts: { agent: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        if (!stack.apiKeys) {
          console.error("API keys require a Cortex connection.");
          process.exitCode = 1;
          return;
        }
        const keyList = await stack.apiKeys.list(opts.agent);
        console.log(`API Keys for agent "${opts.agent}":`);
        if (keyList.length === 0) {
          console.log("  (none)");
        } else {
          for (const k of keyList) {
            const exp = k.expiresAt ? new Date(k.expiresAt).toISOString() : "never";
            console.log(
              `  ${k.id}  ${k.name}  expires=${exp}  scopes=${(k.scopes ?? []).join(",") || "all"}`,
            );
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  keys
    .command("create")
    .description("Create an API key for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .requiredOption("--name <n>", "Key name")
    .option("--scopes <scopes>", "Comma-separated scopes")
    .option("--expires-in-days <days>", "Expiration in days")
    .action(
      async (opts: { agent: string; name: string; scopes?: string; expiresInDays?: string }) => {
        const parent = mamoru.opts();
        try {
          const { stack } = await loadMamoruStack(parent);
          if (!stack.apiKeys) {
            console.error("API keys require a Cortex connection.");
            process.exitCode = 1;
            return;
          }
          const scopes = opts.scopes ? opts.scopes.split(",").map((s) => s.trim()) : undefined;
          const expiresInDays = opts.expiresInDays ? parseInt(opts.expiresInDays, 10) : undefined;
          const result = await stack.apiKeys.create(opts.agent, opts.name, {
            scopes,
            expiresInDays,
          });
          console.log(`API key created: ${result.key.id}`);
          console.log(`  Name:      ${result.key.name}`);
          console.log(`  Plaintext: ${result.plaintext}`);
          console.log("");
          console.log("  Save this key now. It will not be shown again.");
        } catch (err) {
          handleError(err);
        }
      },
    );

  keys
    .command("revoke")
    .description("Revoke an API key")
    .requiredOption("--key <id>", "Key ID to revoke")
    .action(async (opts: { key: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        if (!stack.apiKeys) {
          console.error("API keys require a Cortex connection.");
          process.exitCode = 1;
          return;
        }
        await stack.apiKeys.revoke(opts.key);
        console.log(`Revoked API key: ${opts.key}`);
      } catch (err) {
        handleError(err);
      }
    });

  // ------------------------------------------------------------------
  // mayros mamoru vault
  // ------------------------------------------------------------------
  const vault = mamoru.command("vault").description("Secrets vault (AES-256-GCM encrypted)");

  vault
    .command("list")
    .description("List secret names")
    .option("--scope <scope>", "Filter by scope (global, venture, agent)")
    .action(async (opts: { scope?: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        if (!stack.vault) {
          console.error("Vault requires MAYROS_VAULT_KEY and a Cortex connection.");
          process.exitCode = 1;
          return;
        }
        const secrets = await stack.vault.list({ scope: opts.scope });
        console.log("Secrets:");
        if (secrets.length === 0) {
          console.log("  (none)");
        } else {
          for (const s of secrets) {
            console.log(`  ${s.name}  scope=${s.scope}  version=${s.version}`);
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  vault
    .command("store")
    .description("Store a secret")
    .requiredOption("--name <n>", "Secret name")
    .requiredOption("--value <v>", "Secret value")
    .option("--scope <scope>", "Scope: global, venture, or agent", "global")
    .option("--scope-id <id>", "Scope identifier (venture or agent ID)")
    .action(async (opts: { name: string; value: string; scope?: string; scopeId?: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        if (!stack.vault) {
          console.error("Vault requires MAYROS_VAULT_KEY and a Cortex connection.");
          process.exitCode = 1;
          return;
        }
        const secret = await stack.vault.store(opts.name, opts.value, {
          scope: opts.scope as "global" | "venture" | "agent",
          scopeId: opts.scopeId,
        });
        console.log(`Stored secret: ${secret.name} (version ${secret.version})`);
      } catch (err) {
        handleError(err);
      }
    });

  vault
    .command("get")
    .description("Retrieve a secret value")
    .requiredOption("--name <n>", "Secret name")
    .action(async (opts: { name: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        if (!stack.vault) {
          console.error("Vault requires MAYROS_VAULT_KEY and a Cortex connection.");
          process.exitCode = 1;
          return;
        }
        const value = await stack.vault.retrieve(opts.name);
        if (value === null) {
          console.log(`Secret "${opts.name}" not found.`);
          process.exitCode = 1;
          return;
        }
        // Print raw value to stdout for piping
        process.stdout.write(value);
      } catch (err) {
        handleError(err);
      }
    });

  // ------------------------------------------------------------------
  // mayros mamoru model
  // ------------------------------------------------------------------
  const model = mamoru.command("model").description("Local model detection and setup");

  model
    .command("detect")
    .description("Detect GPU hardware")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const gpu = await stack.localModel.detectGPU();
        console.log("GPU Detection:");
        if (gpu.vendor === "none") {
          console.log("  No GPU detected.");
        } else {
          console.log(`  Vendor:   ${gpu.vendor}`);
          console.log(`  Name:     ${gpu.name}`);
          console.log(`  VRAM:     ${gpu.vramMB ? `${gpu.vramMB} MB` : "unknown"}`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  model
    .command("suggest")
    .description("Suggest local models based on GPU capabilities")
    .option(
      "--activity <type>",
      "Filter by activity: coding, chat, reasoning, creative, analysis, multilingual, vision, agents",
    )
    .action(async (opts: { activity?: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const gpu = await stack.localModel.detectGPU();

        if (opts.activity) {
          // Activity-specific suggestions using the new catalog
          const validActivities = stack.localModel.listActivities().map((a) => a.activity);
          if (!validActivities.includes(opts.activity as never)) {
            console.error(`Unknown activity: ${opts.activity}`);
            console.error(`Valid activities: ${validActivities.join(", ")}`);
            process.exitCode = 1;
            return;
          }
          const activity = opts.activity as Parameters<
            typeof stack.localModel.suggestByActivity
          >[0];
          const models = stack.localModel.suggestByActivity(activity, gpu);
          const activityInfo = stack.localModel
            .listActivities()
            .find((a) => a.activity === activity);
          console.log(
            `Models for "${activityInfo?.label ?? activity}" (VRAM: ${gpu.vramMB}MB ${gpu.vendor}):`,
          );
          console.log(`  ${activityInfo?.description ?? ""}\n`);
          if (models.length === 0) {
            console.log("  No models found for your hardware and selected activity.");
          } else {
            for (const m of models) {
              console.log(
                `  ${m.id}  ${m.parameters}  ${m.provider}  vram=${m.vramRequired}MB  ctx=${m.contextLength}  ${m.runtime}`,
              );
              console.log(`    ${m.strengths}`);
            }
          }
        } else {
          // Legacy behavior — flat suggestions
          const suggestions = stack.localModel.suggestModels(gpu);
          console.log(`Suggested Models (VRAM: ${gpu.vramMB}MB ${gpu.vendor}):`);
          if (suggestions.length === 0) {
            console.log("  No models found for your hardware.");
          } else {
            for (const s of suggestions) {
              console.log(
                `  ${s.model}  runtime=${s.runtime}  vram=${s.vramRequired}MB  — ${s.reason}`,
              );
            }
          }
          console.log(
            "\n  Tip: Use --activity <type> to filter by task. Run 'mayros mamoru model activities' for a list.",
          );
        }
      } catch (err) {
        handleError(err);
      }
    });

  model
    .command("activities")
    .description("List available model activities for --activity filtering")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const activities = stack.localModel.listActivities();
        console.log("Available Model Activities:\n");
        for (const a of activities) {
          console.log(`  ${a.activity.padEnd(14)} ${a.label.padEnd(14)} ${a.description}`);
        }
        console.log("\nUsage: mayros mamoru model suggest --activity <activity>");
      } catch (err) {
        handleError(err);
      }
    });

  model
    .command("test")
    .description("Test a local model endpoint")
    .requiredOption("--endpoint <url>", "Model endpoint URL (e.g., http://localhost:11434)")
    .requiredOption("--model <m>", "Model name (e.g., llama3)")
    .action(async (opts: { endpoint: string; model: string }) => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const result = await stack.localModel.testEndpoint(opts.endpoint, opts.model);
        if (result.ok) {
          console.log(`Model "${opts.model}" is reachable at ${opts.endpoint}`);
          console.log(`  Response time: ${result.latencyMs}ms`);
        } else {
          console.error(`Model test failed: ${result.error}`);
          process.exitCode = 1;
        }
      } catch (err) {
        handleError(err);
      }
    });

  // mayros mamoru model runtimes — detect all available runtimes
  model
    .command("runtimes")
    .description("Detect available local inference runtimes (Docker, Ollama, vLLM, NIM)")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        console.log("Detecting local runtimes...\n");
        const runtimes = await stack.localModel.detectRuntimes();
        for (const r of runtimes) {
          const status = r.installed ? `installed (v${r.version ?? "?"})` : "not installed";
          const gpu = r.gpuSupport ? " [GPU]" : "";
          const endpoint = r.endpoint ? ` → ${r.endpoint}` : "";
          console.log(`  ${r.name}: ${status}${gpu}${endpoint}`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // mayros mamoru model install-guides — show installation commands
  model
    .command("install-guides")
    .description("Show installation commands for each runtime on this platform")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        const guides = stack.localModel.getInstallGuides();
        console.log("Installation Guides:\n");
        for (const g of guides) {
          console.log(`  ${g.runtime} (${g.platform}):`);
          console.log(`    $ ${g.command}`);
          console.log(`    ${g.notes}`);
          console.log(`    Docs: ${g.url}\n`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // mayros mamoru model install-ollama — auto-install Ollama
  model
    .command("install-ollama")
    .description("Install Ollama automatically (winget/brew/curl)")
    .action(async () => {
      const parent = mamoru.opts();
      try {
        const { stack } = await loadMamoruStack(parent);
        console.log("Installing Ollama...");
        const result = await stack.localModel.installOllama();
        if (result.success) {
          console.log(`Done: ${result.message}`);
        } else {
          console.error(result.message);
          process.exitCode = 1;
        }
      } catch (err) {
        handleError(err);
      }
    });
}
