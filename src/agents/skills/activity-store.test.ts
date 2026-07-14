import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readActivityStore,
  writeActivityStore,
  recordSkillInvocation,
  getSkillActivity,
  daysSinceLastInvoked,
} from "./activity-store.js";

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function tempStorePath(): string {
  tempDir = mkdtempSync(join(tmpdir(), "mayros-activity-"));
  return join(tempDir, "skill-activity.json");
}

describe("activity-store", () => {
  it("returns empty record when file does not exist", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mayros-act-")), "missing.json");
    expect(readActivityStore(path)).toEqual({});
  });

  it("writes and reads the store", () => {
    const path = tempStorePath();
    writeActivityStore(
      { "skill-a": { lastInvokedAt: 1000, invocationCount: 5, firstInvokedAt: 500 } },
      path,
    );
    const store = readActivityStore(path);
    expect(store["skill-a"]).toEqual({
      lastInvokedAt: 1000,
      invocationCount: 5,
      firstInvokedAt: 500,
    });
  });

  it("records a new invocation", () => {
    const path = tempStorePath();
    const result = recordSkillInvocation("skill-a", 5000, path);
    expect(result.invocationCount).toBe(1);
    expect(result.lastInvokedAt).toBe(5000);
    expect(result.firstInvokedAt).toBe(5000);
  });

  it("increments count on subsequent invocations", () => {
    const path = tempStorePath();
    recordSkillInvocation("skill-a", 1000, path);
    recordSkillInvocation("skill-a", 2000, path);
    const result = recordSkillInvocation("skill-a", 3000, path);
    expect(result.invocationCount).toBe(3);
    expect(result.lastInvokedAt).toBe(3000);
    expect(result.firstInvokedAt).toBe(1000);
  });

  it("returns null for never-invoked skills", () => {
    const path = tempStorePath();
    expect(getSkillActivity("never", path)).toBeNull();
  });

  it("calculates days since last invocation", () => {
    const path = tempStorePath();
    recordSkillInvocation("skill-a", 1000, path);
    const now = 1000 + 5 * 24 * 60 * 60 * 1000; // 5 days later
    expect(daysSinceLastInvoked("skill-a", now, path)).toBe(5);
  });

  it("returns Infinity for never-invoked skills", () => {
    const path = tempStorePath();
    expect(daysSinceLastInvoked("never", Date.now(), path)).toBe(Infinity);
  });
});
