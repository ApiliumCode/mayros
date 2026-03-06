import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadContextFiles,
  formatContextForPrompt,
  contextToTriples,
  type LoadedContext,
} from "./context-loader.js";

describe("context-loader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-loader-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadContextFiles", () => {
    it("loads project context.md", async () => {
      await fs.mkdir(path.join(tmpDir, ".mayros"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".mayros", "context.md"),
        "# Project Rules\nUse TypeScript.",
      );
      // Create .git to simulate git root
      await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });

      const result = await loadContextFiles(tmpDir);
      const projectSources = result.sources.filter((s) => s.scope === "project");
      expect(projectSources.length).toBeGreaterThanOrEqual(1);
      expect(projectSources[0].content).toContain("Use TypeScript");
    });

    it("loads MAYROS.md as fallback", async () => {
      await fs.writeFile(path.join(tmpDir, "MAYROS.md"), "# Fallback Instructions");
      await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });

      const result = await loadContextFiles(tmpDir);
      const projectSources = result.sources.filter((s) => s.scope === "project");
      expect(projectSources.length).toBeGreaterThanOrEqual(1);
      expect(projectSources[0].content).toContain("Fallback Instructions");
    });

    it("prefers .mayros/context.md over MAYROS.md", async () => {
      await fs.mkdir(path.join(tmpDir, ".mayros"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, ".mayros", "context.md"), "Project context");
      await fs.writeFile(path.join(tmpDir, "MAYROS.md"), "Fallback");
      await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });

      const result = await loadContextFiles(tmpDir);
      const projectSources = result.sources.filter((s) => s.scope === "project");
      // Should have .mayros/context.md but NOT MAYROS.md
      expect(projectSources).toHaveLength(1);
      expect(projectSources[0].content).toBe("Project context");
    });

    it("returns empty for no context files", async () => {
      await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
      const result = await loadContextFiles(tmpDir);
      // May have global context from user's home dir
      const projectSources = result.sources.filter((s) => s.scope === "project");
      expect(projectSources).toHaveLength(0);
    });

    it("handles missing directories gracefully", async () => {
      const result = await loadContextFiles(path.join(tmpDir, "nonexistent"));
      // Should not throw
      expect(result.sources).toBeDefined();
    });
  });

  describe("formatContextForPrompt", () => {
    it("wraps content in project-instructions tags", () => {
      const ctx: LoadedContext = {
        sources: [{ path: "/test/context.md", content: "Use TypeScript", scope: "project" }],
        combinedText: "Use TypeScript",
      };
      const formatted = formatContextForPrompt(ctx);
      expect(formatted).toContain("<project-instructions>");
      expect(formatted).toContain("</project-instructions>");
      expect(formatted).toContain("Use TypeScript");
      expect(formatted).toContain("Project Instructions");
    });

    it("returns empty string for no sources", () => {
      const ctx: LoadedContext = { sources: [], combinedText: "" };
      expect(formatContextForPrompt(ctx)).toBe("");
    });

    it("includes scope labels", () => {
      const ctx: LoadedContext = {
        sources: [
          { path: "~/.mayros/context.md", content: "Global rule", scope: "global" },
          { path: ".mayros/context.md", content: "Project rule", scope: "project" },
        ],
        combinedText: "",
      };
      const formatted = formatContextForPrompt(ctx);
      expect(formatted).toContain("Global Instructions");
      expect(formatted).toContain("Project Instructions");
    });
  });

  describe("contextToTriples", () => {
    it("generates triples for each source", () => {
      const ctx: LoadedContext = {
        sources: [{ path: "/test/context.md", content: "Rules here", scope: "project" }],
        combinedText: "Rules here",
      };
      const triples = contextToTriples("test-ns", ctx);
      expect(triples.length).toBe(4); // path, content, scope, loadedAt
      expect(triples[0].subject).toBe("test-ns:context:project");
      expect(triples[0].predicate).toBe("test-ns:context:path");
    });

    it("truncates content to 4096 chars", () => {
      const longContent = "x".repeat(10000);
      const ctx: LoadedContext = {
        sources: [{ path: "/test", content: longContent, scope: "project" }],
        combinedText: longContent,
      };
      const triples = contextToTriples("ns", ctx);
      const contentTriple = triples.find((t) => t.predicate === "ns:context:content");
      expect(contentTriple?.object.length).toBe(4096);
    });
  });
});
