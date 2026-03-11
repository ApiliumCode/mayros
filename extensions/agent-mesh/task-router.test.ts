import { describe, it, expect } from "vitest";
import { TaskRouter } from "./task-router.js";
import { PerformanceTracker } from "./performance-tracker.js";

// Minimal stubs — no real Cortex
const perfTracker = new PerformanceTracker(null, "test");

describe("TaskRouter", () => {
  it("classifyTask detects code-review", () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const c = router.classifyTask("review the TypeScript code for bugs");
    expect(c.taskType).toBe("code-review");
    expect(c.domain).toBe("typescript");
  });

  it("classifyTask detects security-scan", () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const c = router.classifyTask("run a security audit on the API");
    expect(c.taskType).toBe("security-scan");
  });

  it("classifyTask detects complexity", () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const short = router.classifyTask("fix bug");
    expect(short.complexity).toBe("low");

    const long = router.classifyTask(
      "Review all the entire codebase for multiple security vulnerabilities and create a comprehensive report " +
        "covering each module individually with recommendations for each finding",
    );
    expect(long.complexity).toBe("high");
  });

  it("classifyTask detects domain from path", () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const c = router.classifyTask("fix the issue", "src/main.rs");
    expect(c.domain).toBe("rust");
  });

  it("selectAgent with single agent returns it", async () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const decision = await router.selectAgent("review code", ["agent-a"]);
    expect(decision.agentId).toBe("agent-a");
    expect(decision.confidence).toBe(1.0);
  });

  it("selectAgent with override returns override", async () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const decision = await router.selectAgent(
      "review code",
      ["agent-a", "agent-b"],
      undefined,
      "agent-b",
    );
    expect(decision.agentId).toBe("agent-b");
  });

  it("selectAgent throws with no agents", async () => {
    const router = new TaskRouter(null, "test", perfTracker);
    await expect(router.selectAgent("task", [])).rejects.toThrow("No available agents");
  });

  it("recordReward and computeReward", async () => {
    const router = new TaskRouter(null, "test", perfTracker);
    const decision = await router.selectAgent("implement feature", ["a", "b"]);

    const reward = router.computeReward({
      completed: true,
      findings: 5,
      conflicts: 0,
      durationMs: 10_000,
      costUsd: 0.01,
    });

    expect(reward.completion).toBe(1.0);
    expect(reward.total).toBeGreaterThan(0);

    // Should not throw
    await router.recordReward(decision.routingId, reward);
    expect(router.size()).toBeGreaterThan(0);
  });
});
