import type { MayrosConfig } from "../config/config.js";

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: MayrosConfig,
  workspaceDir: string,
): MayrosConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };
}
