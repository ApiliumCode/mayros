import { describe, expect, it } from "vitest";
import type { MayrosConfig } from "../config/config.js";
import { createCacheTrace } from "./cache-trace.js";

/**
 * cache-trace drift detection unit tests.
 *
 * These cover the system-prompt drift signal added to wrapStreamFn: when the
 * same session sees a different system digest between consecutive stream calls,
 * a `cache:system-drift` event is emitted so cache-breaking changes become
 * visible instead of silently inflating token cost.
 */

type TraceLine = { stage: string; systemDigest?: string; previousSystemDigest?: string };

function makeTrace(sessionKey: string, lines: TraceLine[]) {
  return createCacheTrace({
    cfg: {
      diagnostics: {
        cacheTrace: {
          enabled: true,
          includeSystem: true,
        },
      },
    } as MayrosConfig,
    env: {},
    sessionKey,
    writer: {
      filePath: "memory",
      write: (line: string) => {
        const parsed = JSON.parse(line) as TraceLine;
        lines.push(parsed);
      },
    },
  });
}

// Minimal StreamFn stub: returns an empty async iterable and records nothing.
function noopStreamFn() {
  return (async function* () {
    /* empty */
  })();
}

// The wrapper invokes streamFn(model, context, options). Build a minimal model
// stub and a typed context so tsgo accepts the call without constructing a full
// Model<Api> (which carries many fields irrelevant to drift detection).
type StreamCallContext = { system?: unknown; messages: unknown[] };
function callWrapped(
  wrapped: ReturnType<NonNullable<ReturnType<typeof createCacheTrace>>["wrapStreamFn"]> | undefined,
  system: unknown,
) {
  const model = { id: "m", provider: "anthropic" } as unknown as Parameters<
    NonNullable<typeof wrapped>
  >[0];
  const context = { system, messages: [] } as StreamCallContext as Parameters<
    NonNullable<typeof wrapped>
  >[1];
  wrapped?.(model, context, {});
}

describe("cache-trace drift detection", () => {
  it("does not emit a drift event on the first stream call for a session", () => {
    const lines: TraceLine[] = [];
    const trace = makeTrace("sess-first", lines);
    const wrapped = trace?.wrapStreamFn(noopStreamFn as never);

    callWrapped(wrapped, "system-A");

    const drifts = lines.filter((l) => l.stage === "cache:system-drift");
    expect(drifts).toHaveLength(0);
  });

  it("emits a drift event when the system prompt changes between two calls of the same session", () => {
    const lines: TraceLine[] = [];
    const trace = makeTrace("sess-drift", lines);
    const wrapped = trace?.wrapStreamFn(noopStreamFn as never);

    callWrapped(wrapped, "system-A");
    callWrapped(wrapped, "system-B");

    const drifts = lines.filter((l) => l.stage === "cache:system-drift");
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.previousSystemDigest).toBeDefined();
    expect(drifts[0]?.systemDigest).toBeDefined();
    expect(drifts[0]?.previousSystemDigest).not.toBe(drifts[0]?.systemDigest);
  });

  it("does not emit a drift event when the system prompt stays stable across calls", () => {
    const lines: TraceLine[] = [];
    const trace = makeTrace("sess-stable", lines);
    const wrapped = trace?.wrapStreamFn(noopStreamFn as never);

    callWrapped(wrapped, "same-system");
    callWrapped(wrapped, "same-system");
    callWrapped(wrapped, "same-system");

    const drifts = lines.filter((l) => l.stage === "cache:system-drift");
    expect(drifts).toHaveLength(0);
  });

  it("tracks sessions independently", () => {
    const linesA: TraceLine[] = [];
    const linesB: TraceLine[] = [];
    const traceA = makeTrace("sess-a", linesA);
    const traceB = makeTrace("sess-b", linesB);

    // Session A and B both start with the same system, then A changes.
    callWrapped(traceA?.wrapStreamFn(noopStreamFn as never), "shared-system");
    callWrapped(traceB?.wrapStreamFn(noopStreamFn as never), "shared-system");
    callWrapped(traceA?.wrapStreamFn(noopStreamFn as never), "changed-system");

    const driftsA = linesA.filter((l) => l.stage === "cache:system-drift");
    const driftsB = linesB.filter((l) => l.stage === "cache:system-drift");
    expect(driftsA).toHaveLength(1);
    expect(driftsB).toHaveLength(0);
  });
});
