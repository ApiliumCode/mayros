/**
 * Shared Cortex client resolution for CLI commands.
 *
 * Centralizes the host/port/token resolution logic that was previously
 * duplicated across 15+ CLI files. Resolution order:
 *   1. CLI flags (--cortex-host, --cortex-port, --cortex-token)
 *   2. Environment variables (CORTEX_HOST, CORTEX_PORT, CORTEX_AUTH_TOKEN)
 *   3. Plugin config from mayros.yaml
 *   4. Defaults (127.0.0.1:8080)
 */

import { parseCortexConfig } from "../../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../../extensions/shared/cortex-client.js";
import { loadConfig } from "../../config/config.js";

export type CortexCliOpts = {
  host?: string;
  port?: string;
  token?: string;
};

export type ResolveCortexOptions = {
  /** Plugin name(s) to check in config. First match wins. */
  pluginName?: string | string[];
  /** Default port when no config/env/flag is set (default: 8080). */
  defaultPort?: number;
};

/**
 * Resolve a CortexClient from CLI flags, env vars, or plugin config.
 *
 * @param opts  CLI flags (host, port, token)
 * @param options  Resolution options (pluginName, defaultPort)
 */
export function resolveCortexClient(
  opts: CortexCliOpts,
  options?: ResolveCortexOptions,
): CortexClient {
  const defaultPort = options?.defaultPort ?? 8080;
  const pluginNames = options?.pluginName
    ? Array.isArray(options.pluginName)
      ? options.pluginName
      : [options.pluginName]
    : ["memory-semantic"];

  const host = opts.host ?? process.env.CORTEX_HOST ?? "127.0.0.1";
  const port = opts.port
    ? Number.parseInt(opts.port, 10)
    : process.env.CORTEX_PORT
      ? Number.parseInt(process.env.CORTEX_PORT, 10)
      : defaultPort;
  const authToken = opts.token ?? process.env.CORTEX_AUTH_TOKEN ?? undefined;

  if (!opts.host && !opts.port && !process.env.CORTEX_HOST && !process.env.CORTEX_PORT) {
    try {
      const cfg = loadConfig();
      for (const name of pluginNames) {
        const pluginCfg = cfg.plugins?.entries?.[name]?.config as
          | { cortex?: { host?: string; port?: number; authToken?: string } }
          | undefined;
        if (pluginCfg?.cortex) {
          const cortex = parseCortexConfig(pluginCfg.cortex);
          return new CortexClient(cortex);
        }
      }
    } catch {
      // Config not available — use defaults
    }
  }

  return new CortexClient(parseCortexConfig({ host, port, authToken }));
}

/**
 * Resolve the agent namespace from plugin config.
 *
 * @param pluginName  Plugin name to read namespace from (default: "memory-semantic")
 */
export function resolveNamespace(pluginName?: string): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.[pluginName ?? "memory-semantic"]?.config as
      | { agentNamespace?: string; namespace?: string }
      | undefined;
    return pluginCfg?.agentNamespace ?? pluginCfg?.namespace ?? "mayros";
  } catch {
    return "mayros";
  }
}
