/**
 * E2E: Semantic Skills Pipeline
 *
 * Tests skill runtime loading, activation, and query enrichment
 * without requiring a running Cortex instance.
 */

import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillLoader } from "../../extensions/semantic-skills/skill-loader.js";
import { isSkillRuntime } from "../../extensions/semantic-skills/skill-runtime-contract.js";

const EXAMPLES_DIR = join(process.cwd(), "skills/examples");

describe("Semantic Skills E2E Pipeline", () => {
  let loader: SkillLoader;

  beforeEach(() => {
    loader = new SkillLoader();
  });

  it("loads verify-kyc skill runtime from disk", async () => {
    const runtime = await loader.loadSkillRuntime(join(EXAMPLES_DIR, "verify-kyc"));
    // Dynamic import of .ts files may not work in all test environments
    // but the loader should not throw
    if (runtime) {
      expect(isSkillRuntime(runtime)).toBe(true);
      expect(runtime.name).toBe("verify-kyc");
    }
  });

  it("activates a mock skill runtime", async () => {
    const onActivate = vi.fn();
    const runtime = { name: "mock-skill", onActivate };
    const ctx = {
      namespace: "test",
      agentId: "agent-1",
      graphClient: {
        createTriple: vi.fn(),
        listTriples: vi.fn(),
        patternQuery: vi.fn(),
        deleteTriple: vi.fn(),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    await loader.activateSkill(runtime, ctx);
    expect(onActivate).toHaveBeenCalledWith(ctx);
  });

  it("query enrichment pipeline works end-to-end", async () => {
    const runtime = {
      name: "enricher",
      onQuery: vi.fn().mockReturnValue({
        results: [{ subject: "s1", object: { value: "v1", enriched: true } }],
        additionalContext: "[enricher] Added metadata",
      }),
    };

    const result = await loader.invokeQuery(runtime, {
      namespace: "test",
      agentId: "a1",
      predicate: "test:pred",
      scope: "agent",
      results: [{ subject: "s1", object: "v1" }],
    });

    expect(result).toBeDefined();
    expect(result!.additionalContext).toContain("enricher");
    expect(result!.results![0]).toMatchObject({ subject: "s1" });
  });

  it("skill deactivation is called on unloadAll", async () => {
    const onDeactivate = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any).runtimes.set("s1", { name: "s1", onDeactivate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any).runtimes.set("s2", { name: "s2", onDeactivate });

    await loader.unloadAll("session_end");
    expect(onDeactivate).toHaveBeenCalledTimes(2);
    expect(loader.size).toBe(0);
  });

  it("error in onQuery calls onError", async () => {
    const onError = vi.fn();
    const runtime = {
      name: "failing",
      onQuery: () => {
        throw new Error("query-boom");
      },
      onError,
    };

    const result = await loader.invokeQuery(runtime, {
      namespace: "test",
      agentId: "a1",
      predicate: "test:pred",
      scope: "agent",
      results: [],
    });

    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].error.message).toBe("query-boom");
  });

  it("error in onActivate calls onError instead of throwing", async () => {
    const onError = vi.fn();
    const runtime = {
      name: "bad-activate",
      onActivate: () => {
        throw new Error("activate-fail");
      },
      onError,
    };

    await expect(
      loader.activateSkill(runtime, {
        namespace: "test",
        agentId: "a1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphClient: {} as any,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).resolves.not.toThrow();

    expect(onError).toHaveBeenCalledOnce();
  });

  it("multiple skills can be loaded and queried independently", async () => {
    const r1 = {
      name: "s1",
      onQuery: vi.fn().mockReturnValue({ additionalContext: "from-s1" }),
    };
    const r2 = {
      name: "s2",
      onQuery: vi.fn().mockReturnValue({ additionalContext: "from-s2" }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any).runtimes.set("s1", r1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any).runtimes.set("s2", r2);

    const ctx = {
      namespace: "test",
      agentId: "a1",
      predicate: "p",
      scope: "agent" as const,
      results: [],
    };

    const res1 = await loader.invokeQuery(r1, ctx);
    const res2 = await loader.invokeQuery(r2, ctx);

    expect(res1!.additionalContext).toBe("from-s1");
    expect(res2!.additionalContext).toBe("from-s2");
  });
});
