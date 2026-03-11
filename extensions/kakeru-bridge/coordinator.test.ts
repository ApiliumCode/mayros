import { describe, it, expect } from "vitest";
import { PlatformCoordinator } from "./coordinator.js";
import { ClaudeBridge } from "./bridges/claude-bridge.js";

describe("PlatformCoordinator", () => {
  it("registers and lists bridges", () => {
    const coordinator = new PlatformCoordinator();
    const bridge = new ClaudeBridge();
    coordinator.registerBridge(bridge);

    const list = coordinator.listBridges();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe("claude");
  });

  it("acquires and releases file locks", () => {
    const coordinator = new PlatformCoordinator();

    expect(coordinator.acquireLock("src/app.ts", "claude")).toBe(true);
    expect(coordinator.acquireLock("src/app.ts", "codex")).toBe(false); // conflict
    expect(coordinator.acquireLock("src/app.ts", "claude")).toBe(true); // same owner OK

    coordinator.releaseLock("src/app.ts", "claude");
    expect(coordinator.acquireLock("src/app.ts", "codex")).toBe(true); // now available
  });

  it("releaseAllLocks clears all for a platform", () => {
    const coordinator = new PlatformCoordinator();
    coordinator.acquireLock("a.ts", "claude");
    coordinator.acquireLock("b.ts", "claude");
    coordinator.releaseAllLocks("claude");

    expect(coordinator.acquireLock("a.ts", "codex")).toBe(true);
    expect(coordinator.acquireLock("b.ts", "codex")).toBe(true);
  });

  it("executeWorkflow returns error for missing platform", async () => {
    const coordinator = new PlatformCoordinator();
    const results = await coordinator.executeWorkflow(
      [{ platformId: "unknown", task: { id: "t1", prompt: "test", workDir: "/tmp" } }],
      "kakeru",
    );

    expect(results.get("t1")!.success).toBe(false);
  });

  it("executeWorkflow runs tasks on registered bridges", async () => {
    const coordinator = new PlatformCoordinator();
    const bridge = new ClaudeBridge();
    await bridge.connect();
    coordinator.registerBridge(bridge);

    const results = await coordinator.executeWorkflow(
      [{ platformId: "claude", task: { id: "t1", prompt: "hello", workDir: "/tmp" } }],
      "kakeru",
    );

    // Claude bridge is not yet implemented — returns honest failure
    expect(results.get("t1")!.success).toBe(false);
    expect(results.get("t1")!.output).toContain("not yet implemented");
  });
});
