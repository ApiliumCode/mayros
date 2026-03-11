import { describe, it, expect, beforeEach, vi } from "vitest";
import { AuditTrail, AuditEntry } from "./audit-trail.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

describe("AuditTrail", () => {
  let logPath: string;
  let trail: AuditTrail;

  beforeEach(async () => {
    const tmpDir = path.join(os.tmpdir(), `osameru-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    logPath = path.join(tmpDir, "audit.jsonl");
    trail = new AuditTrail(logPath, "0".repeat(64));
  });

  it("logs entries with HMAC chain", async () => {
    const e1 = await trail.log("test", "agent-a", "allow", { tool: "ls" });
    expect(e1.seq).toBe(1);
    expect(e1.prevHmac).toBe("genesis");
    expect(e1.hmac).toBeTruthy();

    const e2 = await trail.log("test", "agent-b", "deny", { tool: "rm" });
    expect(e2.seq).toBe(2);
    expect(e2.prevHmac).toBe(e1.hmac);
  });

  it("verifies valid chain", async () => {
    await trail.log("test1", "a", "allow", {});
    await trail.log("test2", "b", "deny", {});

    const result = await trail.verify();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(2);
  });

  it("queries with filters", async () => {
    await trail.log("tool_call", "agent-a", "allow", {});
    await trail.log("agent_start", "agent-b", "deny", {});
    await trail.log("tool_call", "agent-a", "deny", {});

    const toolCalls = await trail.query({ event: "tool_call" });
    expect(toolCalls.length).toBe(2);

    const denials = await trail.query({ decision: "deny" });
    expect(denials.length).toBe(2);
  });

  it("handles 10 concurrent log() calls without corrupting the HMAC chain", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      trail.log(`event-${i}`, `actor-${i}`, "allow", { index: i }),
    );
    const entries = await Promise.all(promises);

    // All seq values must be sequential 1..10 with no duplicates
    const seqs = entries.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Read back from disk to verify HMAC chain integrity
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(10);

    const diskEntries = lines.map((l) => JSON.parse(l) as AuditEntry);
    // Verify sequential ordering on disk
    for (let i = 0; i < diskEntries.length; i++) {
      expect(diskEntries[i]!.seq).toBe(i + 1);
      if (i === 0) {
        expect(diskEntries[i]!.prevHmac).toBe("genesis");
      } else {
        expect(diskEntries[i]!.prevHmac).toBe(diskEntries[i - 1]!.hmac);
      }
    }

    // Full chain verification via built-in verify()
    const result = await trail.verify();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(10);
  });

  it("does not throw on disk-full (ENOSPC) and sets lastWriteError", async () => {
    // Log once successfully to initialize
    await trail.log("init", "system", "allow", {});
    expect(trail.lastWriteError).toBeNull();

    // Mock appendFile to simulate ENOSPC
    const enospcError = Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    vi.spyOn(fs, "appendFile").mockRejectedValueOnce(enospcError);

    // Capture stderr output
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // log() should NOT throw
    const entry = await trail.log("test-enospc", "agent-x", "deny", { reason: "full" });
    expect(entry).toBeDefined();
    expect(entry.seq).toBe(2);

    // lastWriteError should be set
    expect(trail.lastWriteError).not.toBeNull();
    expect(trail.lastWriteError!.message).toContain("No space left on device");

    // stderr should have been warned
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[osameru] audit write failed"));

    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("clears lastWriteError after a successful write", async () => {
    // First, force an error
    const enospcError = Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    vi.spyOn(fs, "appendFile").mockRejectedValueOnce(enospcError);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await trail.log("fail-write", "agent", "allow", {});
    expect(trail.lastWriteError).not.toBeNull();

    vi.restoreAllMocks();

    // Next write should succeed and clear the error
    await trail.log("ok-write", "agent", "allow", {});
    expect(trail.lastWriteError).toBeNull();
  });
});
