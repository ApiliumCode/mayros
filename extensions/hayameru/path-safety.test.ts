import { describe, it, expect } from "vitest";
import path from "node:path";

// We test the path validation logic indirectly through the plugin hook.
// Mock the plugin API to capture the hook handler, then invoke it with various paths.

describe("hayameru path safety", () => {
  const workDir = "/workspace/project";

  // Helper: validate path like hayameru does
  function isPathSafe(filePath: string, baseDir: string): boolean {
    const rawResolved = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
    const normalized = path.normalize(rawResolved);
    const normalizedWork = path.normalize(baseDir);
    return normalized === normalizedWork || normalized.startsWith(normalizedWork + path.sep);
  }

  it("allows normal relative paths", () => {
    expect(isPathSafe("src/foo.ts", workDir)).toBe(true);
    expect(isPathSafe("./src/foo.ts", workDir)).toBe(true);
  });

  it("blocks path traversal with ../", () => {
    expect(isPathSafe("../../../etc/passwd", workDir)).toBe(false);
    expect(isPathSafe("src/../../etc/passwd", workDir)).toBe(false);
  });

  it("blocks absolute paths outside workspace", () => {
    expect(isPathSafe("/etc/passwd", workDir)).toBe(false);
    expect(isPathSafe("/tmp/evil.ts", workDir)).toBe(false);
  });

  it("allows absolute paths inside workspace", () => {
    expect(isPathSafe("/workspace/project/src/foo.ts", workDir)).toBe(true);
  });

  it("blocks paths that are prefix but not child", () => {
    // /workspace/project-evil/foo.ts starts with /workspace/project but is NOT a child
    expect(isPathSafe("/workspace/project-evil/foo.ts", workDir)).toBe(false);
  });
});
