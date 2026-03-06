import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TrustedFolderStore } from "./trusted-folders.js";

describe("TrustedFolderStore", () => {
  let tempDir: string;
  let store: TrustedFolderStore;
  let storePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "trusted-test-"));
    storePath = join(tempDir, "trusted-folders.json");
    store = new TrustedFolderStore(storePath);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("loads empty when file does not exist", () => {
    store.load();
    expect(store.listTrusted()).toEqual([]);
  });

  it("trusts and persists a folder", () => {
    store.trust("/home/user/project", "full");
    expect(store.listTrusted()).toHaveLength(1);
    expect(store.listTrusted()[0].trustLevel).toBe("full");

    // Verify persistence
    const store2 = new TrustedFolderStore(storePath);
    store2.load();
    expect(store2.listTrusted()).toHaveLength(1);
  });

  it("checks trust for exact path", () => {
    store.trust("/home/user/project", "full");
    const result = store.checkTrust("/home/user/project");
    expect(result.trusted).toBe(true);
    expect(result.level).toBe("full");
  });

  it("returns not trusted for unknown paths", () => {
    store.trust("/home/user/project", "full");
    const result = store.checkTrust("/home/user/other");
    expect(result.trusted).toBe(false);
    expect(result.level).toBeNull();
  });

  it("child paths inherit parent trust", () => {
    store.trust("/home/user/project", "read-only");
    const result = store.checkTrust("/home/user/project/src/main.ts");
    expect(result.trusted).toBe(true);
    expect(result.level).toBe("read-only");
  });

  it("untrusts a folder", () => {
    store.trust("/home/user/project", "full");
    expect(store.untrust("/home/user/project")).toBe(true);
    expect(store.listTrusted()).toHaveLength(0);
  });

  it("untrust returns false for unknown folder", () => {
    expect(store.untrust("/nonexistent")).toBe(false);
  });

  it("updates trust level on re-trust", () => {
    store.trust("/home/user/project", "full");
    store.trust("/home/user/project", "read-only");
    expect(store.listTrusted()).toHaveLength(1);
    expect(store.listTrusted()[0].trustLevel).toBe("read-only");
  });

  it("handles multiple trusted folders", () => {
    store.trust("/project1", "full");
    store.trust("/project2", "read-only");
    store.trust("/project3", "ask");
    expect(store.listTrusted()).toHaveLength(3);
  });

  it("loads existing valid file", () => {
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        trustedFolders: [
          { path: "/test", trustedAt: "2024-01-01T00:00:00.000Z", trustLevel: "full" },
        ],
      }),
    );
    store.load();
    expect(store.listTrusted()).toHaveLength(1);
    expect(store.listTrusted()[0].path).toBe("/test");
  });

  it("handles malformed JSON gracefully", () => {
    writeFileSync(storePath, "not json{{{");
    store.load();
    expect(store.listTrusted()).toEqual([]);
  });

  it("rejects invalid version", () => {
    writeFileSync(storePath, JSON.stringify({ version: 99, trustedFolders: [] }));
    store.load();
    expect(store.listTrusted()).toEqual([]);
  });

  it("filters invalid entries", () => {
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        trustedFolders: [
          { path: "/valid", trustedAt: "2024-01-01T00:00:00.000Z", trustLevel: "full" },
          { path: 42, trustedAt: "x", trustLevel: "bad" },
          null,
        ],
      }),
    );
    store.load();
    expect(store.listTrusted()).toHaveLength(1);
  });

  it("atomic write survives concurrent reads", () => {
    store.trust("/project1", "full");
    // Another store should be able to read the file
    const store2 = new TrustedFolderStore(storePath);
    store2.load();
    expect(store2.listTrusted()).toHaveLength(1);
  });
});

describe("TrustedFolderStore.getAllowedOperations", () => {
  it("full trust allows everything", () => {
    const ops = TrustedFolderStore.getAllowedOperations("full");
    expect(ops.loadProjectConfig).toBe(true);
    expect(ops.allowHooks).toBe(true);
    expect(ops.allowShellTools).toBe(true);
  });

  it("read-only allows config but not hooks/shell", () => {
    const ops = TrustedFolderStore.getAllowedOperations("read-only");
    expect(ops.loadProjectConfig).toBe(true);
    expect(ops.allowHooks).toBe(false);
    expect(ops.allowShellTools).toBe(false);
  });

  it("ask blocks everything", () => {
    const ops = TrustedFolderStore.getAllowedOperations("ask");
    expect(ops.loadProjectConfig).toBe(false);
    expect(ops.allowHooks).toBe(false);
  });

  it("null blocks everything", () => {
    const ops = TrustedFolderStore.getAllowedOperations(null);
    expect(ops.loadProjectConfig).toBe(false);
    expect(ops.allowShellTools).toBe(false);
  });
});
