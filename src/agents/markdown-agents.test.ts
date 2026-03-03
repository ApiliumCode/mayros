import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMarkdownAgentCache,
  discoverMarkdownAgents,
  findMarkdownAgent,
  parseMarkdownAgentFile,
} from "./markdown-agents.js";

describe("parseMarkdownAgentFile", () => {
  it("parses valid agent file with all frontmatter fields", () => {
    const content = [
      "---",
      "name: Code Reviewer",
      "model: anthropic/claude-sonnet-4-20250514",
      "allowed-tools: bash, grep, read",
      "workspace: ./workspace-reviewer",
      "default: true",
      "---",
      "You are a code reviewer.",
      "",
      "Focus on security and performance.",
    ].join("\n");

    const result = parseMarkdownAgentFile("/tmp/reviewer.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("reviewer");
    expect(result!.name).toBe("Code Reviewer");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result!.allowedTools).toEqual(["bash", "grep", "read"]);
    expect(result!.workspace).toBe("./workspace-reviewer");
    expect(result!.isDefault).toBe(true);
    expect(result!.identity).toBe("You are a code reviewer.\n\nFocus on security and performance.");
    expect(result!.origin).toBe("project");
  });

  it("parses agent with only identity body", () => {
    const content = ["---", "name: Helper", "---", "You are a helpful assistant."].join("\n");

    const result = parseMarkdownAgentFile("/tmp/helper.md", content, "user");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("helper");
    expect(result!.name).toBe("Helper");
    expect(result!.model).toBeUndefined();
    expect(result!.isDefault).toBe(false);
    expect(result!.identity).toBe("You are a helpful assistant.");
    expect(result!.origin).toBe("user");
  });

  it("parses agent with only model config (no body)", () => {
    const content = ["---", "name: Fast Agent", "model: openai/gpt-4o-mini", "---"].join("\n");

    const result = parseMarkdownAgentFile("/tmp/fast.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("fast");
    expect(result!.model).toBe("openai/gpt-4o-mini");
    expect(result!.identity).toBe("");
  });

  it("returns null for file without frontmatter or body", () => {
    const content = "";
    expect(parseMarkdownAgentFile("/tmp/empty.md", content, "project")).toBeNull();
  });

  it("returns null for file with only frontmatter without useful fields", () => {
    const content = ["---", "---"].join("\n");
    expect(parseMarkdownAgentFile("/tmp/bare.md", content, "project")).toBeNull();
  });

  it("returns null for invalid id (starts with number)", () => {
    const content = ["---", "name: Bad", "---", "Identity."].join("\n");
    expect(parseMarkdownAgentFile("/tmp/123bad.md", content, "project")).toBeNull();
  });

  it("defaults name to filename when not in frontmatter", () => {
    const content = ["---", "model: openai/gpt-4o", "---", "Identity."].join("\n");
    const result = parseMarkdownAgentFile("/tmp/myagent.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("myagent");
  });

  it("default is false unless explicitly set to true", () => {
    const content = ["---", "name: Agent", "---", "Identity."].join("\n");
    const result = parseMarkdownAgentFile("/tmp/agent.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.isDefault).toBe(false);
  });

  it("handles hyphenated agent ids", () => {
    const content = ["---", "name: My Agent", "---", "Identity."].join("\n");
    const result = parseMarkdownAgentFile("/tmp/my-agent.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("my-agent");
  });
});

describe("discoverMarkdownAgents (filesystem)", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearMarkdownAgentCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mayros-mdagent-"));
  });

  afterEach(() => {
    clearMarkdownAgentCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(dir: string, name: string, content: string) {
    const agentsDir = path.join(dir, ".mayros", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), content);
  }

  it("discovers agents from project directory", () => {
    writeAgent(
      tmpDir,
      "reviewer",
      ["---", "name: Code Reviewer", "---", "You review code."].join("\n"),
    );
    writeAgent(tmpDir, "writer", ["---", "name: Tech Writer", "---", "You write docs."].join("\n"));

    const agents = discoverMarkdownAgents(tmpDir);
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id)).toEqual(["reviewer", "writer"]); // sorted
  });

  it("returns empty array when no .mayros/agents/ exists", () => {
    const agents = discoverMarkdownAgents(tmpDir);
    expect(agents).toEqual([]);
  });

  it("skips non-.md files", () => {
    const agentsDir = path.join(tmpDir, ".mayros", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "notes.txt"), "not an agent");
    fs.writeFileSync(
      path.join(agentsDir, "valid.md"),
      ["---", "name: Valid Agent", "---", "Identity."].join("\n"),
    );

    const agents = discoverMarkdownAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("valid");
  });

  it("skips invalid agent files", () => {
    writeAgent(tmpDir, "good", ["---", "name: Good", "---", "Identity."].join("\n"));
    writeAgent(tmpDir, "bad", "");

    const agents = discoverMarkdownAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("good");
  });
});

describe("findMarkdownAgent", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearMarkdownAgentCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mayros-mdagent-find-"));
    const agentsDir = path.join(tmpDir, ".mayros", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "reviewer.md"),
      [
        "---",
        "name: Code Reviewer",
        "model: anthropic/claude-sonnet-4-20250514",
        "---",
        "You review code.",
      ].join("\n"),
    );
  });

  afterEach(() => {
    clearMarkdownAgentCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds an agent by id", () => {
    const agent = findMarkdownAgent("reviewer", tmpDir);
    expect(agent).not.toBeUndefined();
    expect(agent!.id).toBe("reviewer");
    expect(agent!.model).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("returns undefined for non-existent agent", () => {
    const agent = findMarkdownAgent("nonexistent", tmpDir);
    expect(agent).toBeUndefined();
  });
});
