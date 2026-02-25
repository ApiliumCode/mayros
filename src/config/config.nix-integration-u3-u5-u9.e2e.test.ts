import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConfigIO,
  DEFAULT_GATEWAY_PORT,
  resolveConfigPathCandidate,
  resolveGatewayPort,
  resolveIsNixMode,
  resolveStateDir,
} from "./config.js";
import { withTempHome } from "./test-helpers.js";

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Hermetic env: don't inherit process.env because other tests may mutate it.
  return { ...overrides };
}

function loadConfigForHome(home: string) {
  return createConfigIO({
    env: envWith({ MAYROS_HOME: home }),
    homedir: () => home,
  }).loadConfig();
}

describe("Nix integration (U3, U5, U9)", () => {
  describe("U3: isNixMode env var detection", () => {
    it("isNixMode is false when MAYROS_NIX_MODE is not set", () => {
      expect(resolveIsNixMode(envWith({ MAYROS_NIX_MODE: undefined }))).toBe(false);
    });

    it("isNixMode is false when MAYROS_NIX_MODE is empty", () => {
      expect(resolveIsNixMode(envWith({ MAYROS_NIX_MODE: "" }))).toBe(false);
    });

    it("isNixMode is false when MAYROS_NIX_MODE is not '1'", () => {
      expect(resolveIsNixMode(envWith({ MAYROS_NIX_MODE: "true" }))).toBe(false);
    });

    it("isNixMode is true when MAYROS_NIX_MODE=1", () => {
      expect(resolveIsNixMode(envWith({ MAYROS_NIX_MODE: "1" }))).toBe(true);
    });
  });

  describe("U5: CONFIG_PATH and STATE_DIR env var overrides", () => {
    it("STATE_DIR defaults to ~/.mayros when env not set", () => {
      expect(resolveStateDir(envWith({ MAYROS_STATE_DIR: undefined }))).toMatch(/\.mayros$/);
    });

    it("STATE_DIR respects MAYROS_STATE_DIR override", () => {
      expect(resolveStateDir(envWith({ MAYROS_STATE_DIR: "/custom/state/dir" }))).toBe(
        path.resolve("/custom/state/dir"),
      );
    });

    it("STATE_DIR respects MAYROS_HOME when state override is unset", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveStateDir(envWith({ MAYROS_HOME: customHome, MAYROS_STATE_DIR: undefined })),
      ).toBe(path.join(path.resolve(customHome), ".mayros"));
    });

    it("CONFIG_PATH defaults to MAYROS_HOME/.mayros/mayros.json", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveConfigPathCandidate(
          envWith({
            MAYROS_HOME: customHome,
            MAYROS_CONFIG_PATH: undefined,
            MAYROS_STATE_DIR: undefined,
          }),
        ),
      ).toBe(path.join(path.resolve(customHome), ".mayros", "mayros.json"));
    });

    it("CONFIG_PATH defaults to ~/.mayros/mayros.json when env not set", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ MAYROS_CONFIG_PATH: undefined, MAYROS_STATE_DIR: undefined }),
        ),
      ).toMatch(/\.mayros[\\/]mayros\.json$/);
    });

    it("CONFIG_PATH respects MAYROS_CONFIG_PATH override", () => {
      expect(
        resolveConfigPathCandidate(envWith({ MAYROS_CONFIG_PATH: "/nix/store/abc/mayros.json" })),
      ).toBe(path.resolve("/nix/store/abc/mayros.json"));
    });

    it("CONFIG_PATH expands ~ in MAYROS_CONFIG_PATH override", async () => {
      await withTempHome(async (home) => {
        expect(
          resolveConfigPathCandidate(
            envWith({ MAYROS_HOME: home, MAYROS_CONFIG_PATH: "~/.mayros/custom.json" }),
            () => home,
          ),
        ).toBe(path.join(home, ".mayros", "custom.json"));
      });
    });

    it("CONFIG_PATH uses STATE_DIR when only state dir is overridden", () => {
      expect(resolveConfigPathCandidate(envWith({ MAYROS_STATE_DIR: "/custom/state" }))).toBe(
        path.join(path.resolve("/custom/state"), "mayros.json"),
      );
    });
  });

  describe("U5b: tilde expansion for config paths", () => {
    it("expands ~ in common path-ish config fields", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".mayros");
        await fs.mkdir(configDir, { recursive: true });
        const pluginDir = path.join(home, "plugins", "demo-plugin");
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(
          path.join(pluginDir, "index.js"),
          'export default { id: "demo-plugin", register() {} };',
          "utf-8",
        );
        await fs.writeFile(
          path.join(pluginDir, "mayros.plugin.json"),
          JSON.stringify(
            {
              id: "demo-plugin",
              configSchema: { type: "object", additionalProperties: false, properties: {} },
            },
            null,
            2,
          ),
          "utf-8",
        );
        await fs.writeFile(
          path.join(configDir, "mayros.json"),
          JSON.stringify(
            {
              plugins: {
                load: {
                  paths: ["~/plugins/demo-plugin"],
                },
              },
              agents: {
                defaults: { workspace: "~/ws-default" },
                list: [
                  {
                    id: "main",
                    workspace: "~/ws-agent",
                    agentDir: "~/.mayros/agents/main",
                    sandbox: { workspaceRoot: "~/sandbox-root" },
                  },
                ],
              },
              channels: {
                whatsapp: {
                  accounts: {
                    personal: {
                      authDir: "~/.mayros/credentials/wa-personal",
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
          "utf-8",
        );

        const cfg = loadConfigForHome(home);

        expect(cfg.plugins?.load?.paths?.[0]).toBe(path.join(home, "plugins", "demo-plugin"));
        expect(cfg.agents?.defaults?.workspace).toBe(path.join(home, "ws-default"));
        expect(cfg.agents?.list?.[0]?.workspace).toBe(path.join(home, "ws-agent"));
        expect(cfg.agents?.list?.[0]?.agentDir).toBe(path.join(home, ".mayros", "agents", "main"));
        expect(cfg.agents?.list?.[0]?.sandbox?.workspaceRoot).toBe(path.join(home, "sandbox-root"));
        expect(cfg.channels?.whatsapp?.accounts?.personal?.authDir).toBe(
          path.join(home, ".mayros", "credentials", "wa-personal"),
        );
      });
    });
  });

  describe("U6: gateway port resolution", () => {
    it("uses default when env and config are unset", () => {
      expect(resolveGatewayPort({}, envWith({ MAYROS_GATEWAY_PORT: undefined }))).toBe(
        DEFAULT_GATEWAY_PORT,
      );
    });

    it("prefers MAYROS_GATEWAY_PORT over config", () => {
      expect(
        resolveGatewayPort({ gateway: { port: 19002 } }, envWith({ MAYROS_GATEWAY_PORT: "19001" })),
      ).toBe(19001);
    });

    it("falls back to config when env is invalid", () => {
      expect(
        resolveGatewayPort({ gateway: { port: 19003 } }, envWith({ MAYROS_GATEWAY_PORT: "nope" })),
      ).toBe(19003);
    });
  });

  describe("U9: telegram.tokenFile schema validation", () => {
    it("accepts config with only botToken", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".mayros");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "mayros.json"),
          JSON.stringify({
            channels: { telegram: { botToken: "123:ABC" } },
          }),
          "utf-8",
        );

        const cfg = loadConfigForHome(home);
        expect(cfg.channels?.telegram?.botToken).toBe("123:ABC");
        expect(cfg.channels?.telegram?.tokenFile).toBeUndefined();
      });
    });

    it("accepts config with only tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".mayros");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "mayros.json"),
          JSON.stringify({
            channels: { telegram: { tokenFile: "/run/agenix/telegram-token" } },
          }),
          "utf-8",
        );

        const cfg = loadConfigForHome(home);
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
        expect(cfg.channels?.telegram?.botToken).toBeUndefined();
      });
    });

    it("accepts config with both botToken and tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".mayros");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "mayros.json"),
          JSON.stringify({
            channels: {
              telegram: {
                botToken: "fallback:token",
                tokenFile: "/run/agenix/telegram-token",
              },
            },
          }),
          "utf-8",
        );

        const cfg = loadConfigForHome(home);
        expect(cfg.channels?.telegram?.botToken).toBe("fallback:token");
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
      });
    });
  });
});
