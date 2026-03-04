import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportSession,
  importSession,
  validateBundle,
  TELEPORT_VERSION,
  type TeleportBundle,
  type ExportOptions,
  type ImportOptions,
} from "./teleport.js";

// ============================================================================
// Test fixtures
// ============================================================================

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "teleport-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createTestTranscript(dir: string, sessionId: string, content: string): string {
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, content, "utf-8");
  return path;
}

function createTestStore(dir: string, sessions: Record<string, unknown>): string {
  const path = join(dir, "sessions.json");
  writeFileSync(path, JSON.stringify(sessions, null, 2), "utf-8");
  return path;
}

function makeBundle(overrides: Partial<TeleportBundle> = {}): TeleportBundle {
  return {
    version: TELEPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDeviceId: "test-device",
    sessionKey: "test-session",
    transcript: Buffer.from('{"role":"user","content":"hello"}\n').toString("base64"),
    sessionStore: { sessionId: "test-session", updatedAt: Date.now() },
    cortexTriples: [],
    ...overrides,
  };
}

// ============================================================================
// validateBundle
// ============================================================================

describe("validateBundle", () => {
  it("accepts a valid bundle", () => {
    expect(validateBundle(makeBundle())).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(validateBundle(null)).toBe(false);
    expect(validateBundle(undefined)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(validateBundle(makeBundle({ version: 99 as never }))).toBe(false);
  });

  it("rejects missing exportedAt", () => {
    const bundle = makeBundle();
    (bundle as Record<string, unknown>).exportedAt = 123;
    expect(validateBundle(bundle)).toBe(false);
  });

  it("rejects missing sessionKey", () => {
    const bundle = makeBundle();
    (bundle as Record<string, unknown>).sessionKey = 42;
    expect(validateBundle(bundle)).toBe(false);
  });

  it("rejects non-array cortexTriples", () => {
    const bundle = makeBundle();
    (bundle as Record<string, unknown>).cortexTriples = "not-array";
    expect(validateBundle(bundle)).toBe(false);
  });

  it("rejects missing sessionStore", () => {
    const bundle = makeBundle();
    (bundle as Record<string, unknown>).sessionStore = null;
    expect(validateBundle(bundle)).toBe(false);
  });
});

// ============================================================================
// exportSession
// ============================================================================

describe("exportSession", () => {
  it("exports transcript as base64", async () => {
    const transcriptContent = '{"role":"user","content":"hello"}\n';
    const transcriptPath = createTestTranscript(tmpDir, "s1", transcriptContent);
    const storePath = createTestStore(tmpDir, {
      s1: { sessionId: "s1", updatedAt: Date.now() },
    });

    const result = await exportSession({
      sessionKey: "s1",
      transcriptPath,
      storePath,
      deviceId: "test-device",
    });

    expect(result.bundle.version).toBe(TELEPORT_VERSION);
    expect(result.bundle.sessionKey).toBe("s1");
    expect(result.bundle.sourceDeviceId).toBe("test-device");
    expect(result.transcriptSize).toBe(transcriptContent.length);

    // Decode and verify transcript
    const decoded = Buffer.from(result.bundle.transcript, "base64").toString("utf-8");
    expect(decoded).toBe(transcriptContent);
  });

  it("exports session store entry", async () => {
    const transcriptPath = createTestTranscript(tmpDir, "s2", "line\n");
    const storePath = createTestStore(tmpDir, {
      s2: { sessionId: "s2", model: "gpt-4", updatedAt: 12345 },
    });

    const result = await exportSession({
      sessionKey: "s2",
      transcriptPath,
      storePath,
    });

    expect(result.bundle.sessionStore).toEqual({
      sessionId: "s2",
      model: "gpt-4",
      updatedAt: 12345,
    });
  });

  it("handles missing transcript file gracefully", async () => {
    const storePath = createTestStore(tmpDir, {
      s3: { sessionId: "s3" },
    });

    const result = await exportSession({
      sessionKey: "s3",
      transcriptPath: join(tmpDir, "nonexistent.jsonl"),
      storePath,
    });

    expect(result.bundle.transcript).toBe("");
    expect(result.transcriptSize).toBe(0);
  });

  it("handles missing store file gracefully", async () => {
    const transcriptPath = createTestTranscript(tmpDir, "s4", "data\n");

    const result = await exportSession({
      sessionKey: "s4",
      transcriptPath,
      storePath: join(tmpDir, "nonexistent.json"),
    });

    expect(result.bundle.sessionStore).toEqual({});
  });

  it("validates the exported bundle structure", async () => {
    const transcriptPath = createTestTranscript(tmpDir, "s5", "data\n");
    const storePath = createTestStore(tmpDir, { s5: { sessionId: "s5" } });

    const result = await exportSession({
      sessionKey: "s5",
      transcriptPath,
      storePath,
    });

    expect(validateBundle(result.bundle)).toBe(true);
  });
});

// ============================================================================
// importSession
// ============================================================================

describe("importSession", () => {
  it("writes transcript to target directory", async () => {
    const targetDir = join(tmpDir, "import-target");
    const storePath = join(targetDir, "sessions.json");
    const bundle = makeBundle({ sessionKey: "imported-1" });

    const result = await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
    });

    expect(result.sessionKey).toBe("imported-1");
    expect(existsSync(result.transcriptPath)).toBe(true);

    const content = readFileSync(result.transcriptPath, "utf-8");
    expect(content).toContain("hello");
  });

  it("creates session store entry", async () => {
    const targetDir = join(tmpDir, "import-store");
    const storePath = join(targetDir, "sessions.json");
    const bundle = makeBundle({ sessionKey: "imported-2" });

    await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
    });

    const store = JSON.parse(readFileSync(storePath, "utf-8"));
    expect(store["imported-2"]).toBeDefined();
    expect(store["imported-2"].updatedAt).toBeGreaterThan(0);
  });

  it("remaps session key when requested", async () => {
    const targetDir = join(tmpDir, "import-remap");
    const storePath = join(targetDir, "sessions.json");
    const bundle = makeBundle({ sessionKey: "original-key" });

    const result = await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
      remapSessionKey: "new-key",
    });

    expect(result.sessionKey).toBe("new-key");
    expect(result.remapped).toBe(true);

    const store = JSON.parse(readFileSync(storePath, "utf-8"));
    expect(store["new-key"]).toBeDefined();
    expect(store["original-key"]).toBeUndefined();
  });

  it("merges into existing store", async () => {
    const targetDir = join(tmpDir, "import-merge");
    mkdirSync(targetDir, { recursive: true });
    const storePath = createTestStore(targetDir, {
      "existing-session": { sessionId: "existing", model: "gpt-4" },
    });
    const bundle = makeBundle({ sessionKey: "new-session" });

    await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
    });

    const store = JSON.parse(readFileSync(storePath, "utf-8"));
    expect(store["existing-session"]).toBeDefined();
    expect(store["new-session"]).toBeDefined();
  });

  it("handles empty transcript", async () => {
    const targetDir = join(tmpDir, "import-empty");
    const storePath = join(targetDir, "sessions.json");
    const bundle = makeBundle({ sessionKey: "empty-1", transcript: "" });

    const result = await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
    });

    expect(result.sessionKey).toBe("empty-1");
    expect(result.triplesImported).toBe(0);
  });

  it("returns correct triple count without Cortex", async () => {
    const targetDir = join(tmpDir, "import-notriples");
    const storePath = join(targetDir, "sessions.json");
    const bundle = makeBundle({
      sessionKey: "no-cortex",
      cortexTriples: [
        { subject: "s1", predicate: "p1", object: "o1" },
        { subject: "s2", predicate: "p2", object: "o2" },
      ],
    });

    const result = await importSession({
      bundle,
      targetTranscriptDir: targetDir,
      targetStorePath: storePath,
      // No cortexClient — triples won't be imported
    });

    expect(result.triplesImported).toBe(0);
  });
});

// ============================================================================
// Round-trip export/import
// ============================================================================

describe("round-trip", () => {
  it("preserves transcript through export+import cycle", async () => {
    const exportDir = join(tmpDir, "roundtrip-export");
    const importDir = join(tmpDir, "roundtrip-import");
    mkdirSync(exportDir, { recursive: true });

    const originalContent =
      '{"role":"user","content":"roundtrip test"}\n{"role":"assistant","content":"ok"}\n';
    const transcriptPath = createTestTranscript(exportDir, "rt-1", originalContent);
    const storePath = createTestStore(exportDir, {
      "rt-1": { sessionId: "rt-1", model: "claude-3", updatedAt: 99999 },
    });

    // Export
    const exported = await exportSession({
      sessionKey: "rt-1",
      transcriptPath,
      storePath,
      deviceId: "device-a",
    });

    // Import
    const importStorePath = join(importDir, "sessions.json");
    const imported = await importSession({
      bundle: exported.bundle,
      targetTranscriptDir: importDir,
      targetStorePath: importStorePath,
    });

    // Verify transcript preserved
    const importedContent = readFileSync(imported.transcriptPath, "utf-8");
    expect(importedContent).toBe(originalContent);

    // Verify store preserved
    const store = JSON.parse(readFileSync(importStorePath, "utf-8"));
    expect(store["rt-1"].model).toBe("claude-3");
  });
});
