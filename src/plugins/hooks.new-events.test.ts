import { describe, expect, it, vi } from "vitest";
import { createHookRunner } from "./hooks.js";
import { createMockPluginRegistry } from "./hooks.test-helpers.js";

describe("permission_request hook", () => {
  it("runs handler and returns result", async () => {
    const handler = vi.fn().mockResolvedValue({ action: "deny", reason: "policy" });
    const registry = createMockPluginRegistry([{ hookName: "permission_request", handler }]);
    const runner = createHookRunner(registry);

    const result = await runner.runPermissionRequest(
      { toolName: "bash", params: { command: "rm -rf /" }, riskLevel: "critical" },
      { toolName: "bash", agentId: "main", sessionKey: "s1" },
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "bash", riskLevel: "critical" }),
      expect.objectContaining({ toolName: "bash", agentId: "main" }),
    );
    expect(result).toEqual({ action: "deny", reason: "policy" });
  });

  it("merges results — first action wins", async () => {
    const h1 = vi.fn().mockResolvedValue({ action: "allow" as const });
    const h2 = vi.fn().mockResolvedValue({ action: "deny" as const, reason: "blocked" });
    const registry = createMockPluginRegistry([
      { hookName: "permission_request", handler: h1 },
      { hookName: "permission_request", handler: h2 },
    ]);
    const runner = createHookRunner(registry);

    const result = await runner.runPermissionRequest(
      { toolName: "write", params: {}, riskLevel: "medium" },
      { toolName: "write" },
    );

    expect(result?.action).toBe("allow");
  });

  it("returns undefined when no handlers registered", async () => {
    const registry = createMockPluginRegistry([]);
    const runner = createHookRunner(registry);

    const result = await runner.runPermissionRequest(
      { toolName: "read", params: {}, riskLevel: "low" },
      { toolName: "read" },
    );

    expect(result).toBeUndefined();
  });
});

describe("notification hook", () => {
  it("runs handlers in parallel", async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    const h2 = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginRegistry([
      { hookName: "notification", handler: h1 },
      { hookName: "notification", handler: h2 },
    ]);
    const runner = createHookRunner(registry);

    await runner.runNotification(
      { level: "info", title: "Build complete", body: "All tests pass" },
      { agentId: "main" },
    );

    expect(h1).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", title: "Build complete" }),
      expect.objectContaining({ agentId: "main" }),
    );
    expect(h2).toHaveBeenCalledOnce();
  });

  it("catches handler errors when catchErrors is true", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const registry = createMockPluginRegistry([{ hookName: "notification", handler }]);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const runner = createHookRunner(registry, { catchErrors: true, logger });

    await expect(
      runner.runNotification({ level: "error", title: "test" }, {}),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("teammate_idle hook", () => {
  it("invokes registered handlers", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginRegistry([{ hookName: "teammate_idle", handler }]);
    const runner = createHookRunner(registry);

    await runner.runTeammateIdle(
      { agentId: "worker-1", sessionKey: "s:worker-1", idleDurationMs: 60_000 },
      { agentId: "orchestrator" },
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "worker-1", idleDurationMs: 60_000 }),
      expect.objectContaining({ agentId: "orchestrator" }),
    );
  });

  it("returns undefined with no handlers", async () => {
    const registry = createMockPluginRegistry([]);
    const runner = createHookRunner(registry);
    await runner.runTeammateIdle({ agentId: "a", sessionKey: "s", idleDurationMs: 0 }, {});
    // Just verify it doesn't throw
  });
});

describe("task_completed hook", () => {
  it("invokes registered handlers with full event data", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginRegistry([{ hookName: "task_completed", handler }]);
    const runner = createHookRunner(registry);

    await runner.runTaskCompleted(
      {
        taskId: "task-42",
        agentId: "worker-1",
        sessionKey: "s1",
        outcome: "success",
        durationMs: 12_500,
        result: { filesChanged: 3 },
      },
      { agentId: "orchestrator" },
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-42",
        outcome: "success",
        durationMs: 12_500,
      }),
      expect.objectContaining({ agentId: "orchestrator" }),
    );
  });

  it("handles failure outcomes", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginRegistry([{ hookName: "task_completed", handler }]);
    const runner = createHookRunner(registry);

    await runner.runTaskCompleted(
      {
        taskId: "task-99",
        agentId: "worker-2",
        outcome: "failure",
        error: "compilation failed",
      },
      {},
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure", error: "compilation failed" }),
      expect.anything(),
    );
  });
});

describe("config_change hook", () => {
  it("invokes registered handlers", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginRegistry([{ hookName: "config_change", handler }]);
    const runner = createHookRunner(registry);

    await runner.runConfigChange(
      {
        changedKeys: ["ui.theme", "hooks.enabled"],
        source: "user",
        timestamp: Date.now(),
      },
      { agentId: "main" },
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        changedKeys: ["ui.theme", "hooks.enabled"],
        source: "user",
      }),
      expect.objectContaining({ agentId: "main" }),
    );
  });

  it("multiple handlers run in parallel", async () => {
    const order: number[] = [];
    const h1 = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    const h2 = vi.fn().mockImplementation(async () => {
      order.push(2);
    });
    const registry = createMockPluginRegistry([
      { hookName: "config_change", handler: h1 },
      { hookName: "config_change", handler: h2 },
    ]);
    const runner = createHookRunner(registry);

    await runner.runConfigChange(
      { changedKeys: ["test"], source: "cli", timestamp: Date.now() },
      {},
    );

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    // h2 should finish before h1 due to parallel execution
    expect(order).toEqual([2, 1]);
  });
});

describe("hook count includes new hooks", () => {
  it("hasHooks returns true for new hook names", () => {
    const handler = vi.fn();
    const registry = createMockPluginRegistry([
      { hookName: "permission_request", handler },
      { hookName: "notification", handler },
      { hookName: "teammate_idle", handler },
      { hookName: "task_completed", handler },
      { hookName: "config_change", handler },
    ]);
    const runner = createHookRunner(registry);

    expect(runner.hasHooks("permission_request")).toBe(true);
    expect(runner.hasHooks("notification")).toBe(true);
    expect(runner.hasHooks("teammate_idle")).toBe(true);
    expect(runner.hasHooks("task_completed")).toBe(true);
    expect(runner.hasHooks("config_change")).toBe(true);
  });

  it("getHookCount returns correct counts", () => {
    const handler = vi.fn();
    const registry = createMockPluginRegistry([
      { hookName: "notification", handler },
      { hookName: "notification", handler },
      { hookName: "config_change", handler },
    ]);
    const runner = createHookRunner(registry);

    expect(runner.getHookCount("notification")).toBe(2);
    expect(runner.getHookCount("config_change")).toBe(1);
    expect(runner.getHookCount("permission_request")).toBe(0);
  });
});
