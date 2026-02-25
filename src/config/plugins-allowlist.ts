import type { MayrosConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: MayrosConfig, pluginId: string): MayrosConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
