import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileDiscoveryService } from "./file-discovery.js";

// ============================================================================
// Test fixture helpers
// ============================================================================

let tmpDir: string;

function mkfile(relativePath: string, content = ""): void {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-discovery-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe("FileDiscoveryService#scoreRelevance", () => {
  it("returns 0 for an empty query", () => {
    const svc = new FileDiscoveryService(tmpDir);
    expect(svc.scoreRelevance("src/utils.ts", "")).toBe(0);
  });

  it("gives higher score when filename matches the query", () => {
    const svc = new FileDiscoveryService(tmpDir);
    const fileMatch = svc.scoreRelevance("src/parser.ts", "parser");
    const dirOnly = svc.scoreRelevance("parser/index.ts", "parser");
    // filename match adds 0.4, dir match adds 0.3
    expect(fileMatch).toBeGreaterThanOrEqual(dirOnly);
  });
});

describe("FileDiscoveryService#discoverRelevant", () => {
  it("finds files matching the query in name or directory", async () => {
    mkfile("src/auth/login.ts");
    mkfile("src/auth/register.ts");
    mkfile("src/utils/helpers.ts");

    const svc = new FileDiscoveryService(tmpDir);
    const results = await svc.discoverRelevant("auth");

    expect(results.length).toBe(2);
    expect(results[0].path).toContain("auth");
  });

  it("respects maxFiles limit", async () => {
    for (let i = 0; i < 30; i++) {
      mkfile(`dir/file-${i}.ts`);
    }

    const svc = new FileDiscoveryService(tmpDir, { maxFiles: 5 });
    const results = await svc.discoverRelevant("file");
    expect(results.length).toBe(5);
  });

  it("ignores node_modules by default", async () => {
    mkfile("node_modules/pkg/index.js");
    mkfile("src/index.ts");

    const svc = new FileDiscoveryService(tmpDir);
    const results = await svc.discoverRelevant("index");
    expect(results.every((r) => !r.path.includes("node_modules"))).toBe(true);
  });
});

describe("FileDiscoveryService#findByExtension", () => {
  it("returns only files matching the given extensions", async () => {
    mkfile("a.ts");
    mkfile("b.js");
    mkfile("c.json");

    const svc = new FileDiscoveryService(tmpDir);
    const files = await svc.findByExtension([".ts", ".js"]);

    expect(files.length).toBe(2);
    expect(files.every((f) => f.endsWith(".ts") || f.endsWith(".js"))).toBe(true);
  });
});

describe("FileDiscoveryService#getProjectStructure", () => {
  it("lists top-level directories and key files", async () => {
    mkfile("package.json", "{}");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.mkdirSync(path.join(tmpDir, "extensions"));
    // node_modules should be ignored
    fs.mkdirSync(path.join(tmpDir, "node_modules"));

    const svc = new FileDiscoveryService(tmpDir);
    const structure = await svc.getProjectStructure();

    expect(structure).toContain("src/");
    expect(structure).toContain("extensions/");
    expect(structure).toContain("package.json");
    expect(structure).not.toContain("node_modules");
  });
});

describe("FileDiscoveryService depth limiting", () => {
  it("stops walking beyond maxDepth", async () => {
    // Create deeply nested file: depth 0 → d1 → d2 → d3 → d4 → d5 → d6
    mkfile("d1/d2/d3/d4/d5/d6/deep.ts");
    // Create shallow file
    mkfile("d1/shallow.ts");

    const svc = new FileDiscoveryService(tmpDir, { maxDepth: 2 });
    const results = await svc.discoverRelevant("deep");

    // deep.ts is at depth 6 — should not be found
    expect(results.every((r) => !r.path.includes("deep.ts"))).toBe(true);
  });
});
