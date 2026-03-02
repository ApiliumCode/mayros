import { vi } from "vitest";

const _accountsMock = vi.hoisted(() => ({
  resolveBlueBubblesAccount: vi.fn(
    (params: {
      cfg?: { channels?: { bluebubbles?: Record<string, unknown> } };
      accountId?: string;
    }) => {
      const config = params.cfg?.channels?.bluebubbles ?? {};
      return {
        accountId: params.accountId ?? "default",
        enabled: config.enabled !== false,
        configured: Boolean(config.serverUrl && config.password),
        config,
      };
    },
  ),
}));

const _probeMock = vi.hoisted(() => ({
  getCachedBlueBubblesPrivateApiStatus: vi.fn<() => boolean | null>().mockReturnValue(null),
}));

vi.mock("./accounts.js", () => _accountsMock);

vi.mock("./probe.js", () => _probeMock);

export const accountsMock = _accountsMock;
export const probeMock = _probeMock;
