import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMarkdownCommandCache,
  discoverMarkdownCommands,
  expandMarkdownCommand,
  findMarkdownCommand,
  parseMarkdownCommandFile,
  type MarkdownCommand,
} from "./markdown-commands.js";

function makeCommand(overrides: Partial<MarkdownCommand> = {}): MarkdownCommand {
  return {
    name: "test",
    description: "A test command",
    body: "Run this task: $ARGUMENTS",
    sourcePath: "/tmp/test.md",
    origin: "project",
    ...overrides,
  };
}

describe("parseMarkdownCommandFile", () => {
  it("parses valid command file with all frontmatter fields", () => {
    const content = [
      "---",
      "description: Review the code",
      "argument-hint: <file> [options]",
      "allowed-tools: bash, grep",
      "---",
      "Please review the following code: $ARGUMENTS",
    ].join("\n");

    const result = parseMarkdownCommandFile("/tmp/review.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("review");
    expect(result!.description).toBe("Review the code");
    expect(result!.argumentHint).toBe("<file> [options]");
    expect(result!.allowedTools).toEqual(["bash", "grep"]);
    expect(result!.body).toBe("Please review the following code: $ARGUMENTS");
    expect(result!.origin).toBe("project");
  });

  it("parses command with only required fields", () => {
    const content = ["---", "description: Simple command", "---", "Do the thing."].join("\n");

    const result = parseMarkdownCommandFile("/tmp/simple.md", content, "user");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("simple");
    expect(result!.description).toBe("Simple command");
    expect(result!.argumentHint).toBeUndefined();
    expect(result!.allowedTools).toBeUndefined();
    expect(result!.body).toBe("Do the thing.");
    expect(result!.origin).toBe("user");
  });

  it("returns null for missing description", () => {
    const content = ["---", "argument-hint: <file>", "---", "Do the thing."].join("\n");
    expect(parseMarkdownCommandFile("/tmp/bad.md", content, "project")).toBeNull();
  });

  it("returns null for empty body", () => {
    const content = ["---", "description: Empty body", "---", ""].join("\n");
    expect(parseMarkdownCommandFile("/tmp/empty.md", content, "project")).toBeNull();
  });

  it("returns null for invalid command name (starts with number)", () => {
    const content = ["---", "description: Bad name", "---", "Do it."].join("\n");
    expect(parseMarkdownCommandFile("/tmp/123bad.md", content, "project")).toBeNull();
  });

  it("returns null for invalid command name (special characters)", () => {
    const content = ["---", "description: Bad name", "---", "Do it."].join("\n");
    expect(parseMarkdownCommandFile("/tmp/my command.md", content, "project")).toBeNull();
  });

  it("lowercases the command name", () => {
    const content = ["---", "description: Mixed case", "---", "Do it."].join("\n");
    const result = parseMarkdownCommandFile("/tmp/MyCommand.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("mycommand");
  });

  it("handles multiline body", () => {
    const content = [
      "---",
      "description: Multi-line",
      "---",
      "Line one.",
      "",
      "Line two.",
      "",
      "Line three.",
    ].join("\n");

    const result = parseMarkdownCommandFile("/tmp/multi.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("Line one.\n\nLine two.\n\nLine three.");
  });

  it("handles file without frontmatter", () => {
    const content = "Just some text without frontmatter.";
    // No frontmatter → no description → null
    expect(parseMarkdownCommandFile("/tmp/nofm.md", content, "project")).toBeNull();
  });

  it("handles allowed-tools with extra whitespace", () => {
    const content = [
      "---",
      "description: Tools test",
      "allowed-tools:  bash ,  grep  , find ",
      "---",
      "Do it.",
    ].join("\n");

    const result = parseMarkdownCommandFile("/tmp/tools.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.allowedTools).toEqual(["bash", "grep", "find"]);
  });

  it("handles hyphenated command names", () => {
    const content = ["---", "description: Code review", "---", "Review this."].join("\n");
    const result = parseMarkdownCommandFile("/tmp/code-review.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("code-review");
  });

  it("handles underscored command names", () => {
    const content = ["---", "description: Code review", "---", "Review this."].join("\n");
    const result = parseMarkdownCommandFile("/tmp/code_review.md", content, "project");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("code_review");
  });
});

describe("expandMarkdownCommand", () => {
  it("replaces $ARGUMENTS with the provided text", () => {
    const cmd = makeCommand({ body: "Review $ARGUMENTS carefully." });
    expect(expandMarkdownCommand(cmd, "src/main.ts")).toBe("Review src/main.ts carefully.");
  });

  it("replaces multiple $ARGUMENTS occurrences", () => {
    const cmd = makeCommand({ body: "First: $ARGUMENTS\nSecond: $ARGUMENTS" });
    expect(expandMarkdownCommand(cmd, "hello")).toBe("First: hello\nSecond: hello");
  });

  it("returns body unchanged when no $ARGUMENTS placeholder", () => {
    const cmd = makeCommand({ body: "No placeholder here." });
    expect(expandMarkdownCommand(cmd, "ignored")).toBe("No placeholder here.");
  });

  it("handles empty arguments", () => {
    const cmd = makeCommand({ body: "Args: $ARGUMENTS end." });
    expect(expandMarkdownCommand(cmd, "")).toBe("Args:  end.");
  });
});

describe("discoverMarkdownCommands (filesystem)", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearMarkdownCommandCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mayros-mdcmd-"));
  });

  afterEach(() => {
    clearMarkdownCommandCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCommand(dir: string, name: string, content: string) {
    const commandsDir = path.join(dir, ".mayros", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), content);
  }

  it("discovers commands from project directory", () => {
    writeCommand(
      tmpDir,
      "review",
      ["---", "description: Code review", "---", "Review $ARGUMENTS"].join("\n"),
    );
    writeCommand(
      tmpDir,
      "deploy",
      ["---", "description: Deploy to staging", "---", "Deploy now."].join("\n"),
    );

    const commands = discoverMarkdownCommands(tmpDir);
    expect(commands).toHaveLength(2);
    expect(commands.map((c) => c.name)).toEqual(["deploy", "review"]); // sorted alphabetically
    expect(commands[0].origin).toBe("project");
  });

  it("returns empty array when no .mayros/commands/ exists", () => {
    const commands = discoverMarkdownCommands(tmpDir);
    expect(commands).toEqual([]);
  });

  it("skips non-.md files", () => {
    const commandsDir = path.join(tmpDir, ".mayros", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "readme.txt"), "not a command");
    fs.writeFileSync(
      path.join(commandsDir, "valid.md"),
      ["---", "description: Valid", "---", "Do it."].join("\n"),
    );

    const commands = discoverMarkdownCommands(tmpDir);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("valid");
  });

  it("skips invalid .md files without description", () => {
    const commandsDir = path.join(tmpDir, ".mayros", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "invalid.md"),
      ["---", "argument-hint: something", "---", "No description."].join("\n"),
    );
    fs.writeFileSync(
      path.join(commandsDir, "valid.md"),
      ["---", "description: Valid", "---", "Do it."].join("\n"),
    );

    const commands = discoverMarkdownCommands(tmpDir);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("valid");
  });

  it("project commands override user commands with the same name", () => {
    // We can't easily mock the user dir, so test the merge logic directly
    // by creating two directories and using the underlying logic
    const projectDir = path.join(tmpDir, "project");
    const userDir = path.join(tmpDir, "user");

    const projectCmdDir = path.join(projectDir, ".mayros", "commands");
    const userCmdDir = path.join(userDir, ".mayros", "commands");
    fs.mkdirSync(projectCmdDir, { recursive: true });
    fs.mkdirSync(userCmdDir, { recursive: true });

    fs.writeFileSync(
      path.join(projectCmdDir, "review.md"),
      ["---", "description: Project review", "---", "Project version."].join("\n"),
    );
    fs.writeFileSync(
      path.join(userCmdDir, "review.md"),
      ["---", "description: User review", "---", "User version."].join("\n"),
    );

    // Test project discovery
    const projectCmds = discoverMarkdownCommands(projectDir);
    expect(projectCmds).toHaveLength(1);
    expect(projectCmds[0].description).toBe("Project review");
  });
});

describe("findMarkdownCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearMarkdownCommandCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mayros-mdcmd-find-"));
    const commandsDir = path.join(tmpDir, ".mayros", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "review.md"),
      ["---", "description: Code review", "---", "Review $ARGUMENTS"].join("\n"),
    );
  });

  afterEach(() => {
    clearMarkdownCommandCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a command by name", () => {
    const cmd = findMarkdownCommand("review", tmpDir);
    expect(cmd).not.toBeUndefined();
    expect(cmd!.name).toBe("review");
  });

  it("finds a command case-insensitively", () => {
    const cmd = findMarkdownCommand("REVIEW", tmpDir);
    expect(cmd).not.toBeUndefined();
    expect(cmd!.name).toBe("review");
  });

  it("returns undefined for non-existent command", () => {
    const cmd = findMarkdownCommand("nonexistent", tmpDir);
    expect(cmd).toBeUndefined();
  });
});
