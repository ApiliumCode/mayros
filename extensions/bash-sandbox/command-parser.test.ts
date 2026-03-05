/**
 * Command Parser Tests
 *
 * Tests cover:
 * - Simple commands with args and flags
 * - Pipe chains (|)
 * - Logical chains (&&, ||, ;)
 * - Quoted strings (single, double, escaped)
 * - Sudo detection and prefix stripping
 * - Redirect detection (>, >>, <, 2>)
 * - Subshell detection ($(...), `...`)
 * - Environment variable prefixes (FOO=bar cmd)
 * - Empty input
 * - Complex multi-operator chains
 */

import { describe, it, expect } from "vitest";
import { parseCommandChain } from "./command-parser.js";

// ============================================================================
// Simple Commands
// ============================================================================

describe("parseCommandChain — simple commands", () => {
  it("parses a single command with no args", () => {
    const chain = parseCommandChain("ls");
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("ls");
    expect(chain.commands[0].args).toEqual([]);
    expect(chain.commands[0].isPiped).toBe(false);
    expect(chain.commands[0].isChained).toBe(false);
    expect(chain.commands[0].hasSudo).toBe(false);
    expect(chain.commands[0].hasRedirect).toBe(false);
    expect(chain.commands[0].isSubshell).toBe(false);
  });

  it("parses a command with args", () => {
    const chain = parseCommandChain("ls -la /tmp");
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("ls");
    expect(chain.commands[0].args).toEqual(["-la", "/tmp"]);
  });

  it("parses a command with flags and values", () => {
    const chain = parseCommandChain("git commit -m 'initial commit'");
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("git");
    expect(chain.commands[0].args).toEqual(["commit", "-m", "'initial commit'"]);
  });

  it("preserves the raw command string", () => {
    const chain = parseCommandChain("echo hello world");
    expect(chain.raw).toBe("echo hello world");
    expect(chain.commands[0].raw).toBe("echo hello world");
  });

  it("handles commands with full paths", () => {
    const chain = parseCommandChain("/usr/bin/env node script.js");
    expect(chain.commands[0].executable).toBe("/usr/bin/env");
    expect(chain.commands[0].args).toEqual(["node", "script.js"]);
  });
});

// ============================================================================
// Pipes
// ============================================================================

describe("parseCommandChain — pipes", () => {
  it("parses a simple pipe", () => {
    const chain = parseCommandChain("cat file.txt | grep error");
    expect(chain.commands).toHaveLength(2);
    expect(chain.commands[0].executable).toBe("cat");
    expect(chain.commands[0].isPiped).toBe(false);
    expect(chain.commands[1].executable).toBe("grep");
    expect(chain.commands[1].isPiped).toBe(true);
  });

  it("parses a multi-stage pipe", () => {
    const chain = parseCommandChain("cat log | grep error | wc -l");
    expect(chain.commands).toHaveLength(3);
    expect(chain.commands[0].executable).toBe("cat");
    expect(chain.commands[1].executable).toBe("grep");
    expect(chain.commands[1].isPiped).toBe(true);
    expect(chain.commands[2].executable).toBe("wc");
    expect(chain.commands[2].isPiped).toBe(true);
    expect(chain.commands[2].args).toEqual(["-l"]);
  });

  it("does not split pipes inside double quotes", () => {
    const chain = parseCommandChain('echo "hello | world"');
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("echo");
    expect(chain.commands[0].args).toEqual(['"hello | world"']);
  });

  it("does not split pipes inside single quotes", () => {
    const chain = parseCommandChain("echo 'a | b'");
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("echo");
  });
});

// ============================================================================
// Chains (&&, ||, ;)
// ============================================================================

describe("parseCommandChain — chains", () => {
  it("parses && chains", () => {
    const chain = parseCommandChain("mkdir dir && cd dir");
    expect(chain.commands).toHaveLength(2);
    expect(chain.commands[0].executable).toBe("mkdir");
    expect(chain.commands[0].isChained).toBe(false);
    expect(chain.commands[1].executable).toBe("cd");
    expect(chain.commands[1].isChained).toBe(true);
  });

  it("parses || chains", () => {
    const chain = parseCommandChain("test -f file || echo missing");
    expect(chain.commands).toHaveLength(2);
    expect(chain.commands[1].executable).toBe("echo");
    expect(chain.commands[1].isChained).toBe(true);
  });

  it("parses semicolon chains", () => {
    const chain = parseCommandChain("echo a; echo b; echo c");
    expect(chain.commands).toHaveLength(3);
    expect(chain.commands[1].isChained).toBe(true);
    expect(chain.commands[2].isChained).toBe(true);
  });

  it("parses mixed operators", () => {
    const chain = parseCommandChain("ls && echo ok || echo fail; pwd");
    expect(chain.commands).toHaveLength(4);
    expect(chain.commands[0].executable).toBe("ls");
    expect(chain.commands[1].executable).toBe("echo");
    expect(chain.commands[2].executable).toBe("echo");
    expect(chain.commands[3].executable).toBe("pwd");
  });

  it("does not split && inside quotes", () => {
    const chain = parseCommandChain('echo "a && b"');
    expect(chain.commands).toHaveLength(1);
  });
});

// ============================================================================
// Quoted Strings
// ============================================================================

describe("parseCommandChain — quoted strings", () => {
  it("preserves double-quoted strings as single tokens", () => {
    const chain = parseCommandChain('echo "hello world"');
    expect(chain.commands[0].args).toEqual(['"hello world"']);
  });

  it("preserves single-quoted strings as single tokens", () => {
    const chain = parseCommandChain("echo 'hello world'");
    expect(chain.commands[0].args).toEqual(["'hello world'"]);
  });

  it("handles escaped characters", () => {
    const chain = parseCommandChain("echo hello\\ world");
    // Backslash-space in shell escapes the space, keeping it as one token
    expect(chain.commands[0].args).toEqual(["hello\\ world"]);
  });

  it("handles mixed quote styles", () => {
    const chain = parseCommandChain('echo "it\'s" \'a "test"\'');
    expect(chain.commands[0].args).toEqual(['"it\'s"', "'a \"test\"'"]);
  });
});

// ============================================================================
// Sudo Detection
// ============================================================================

describe("parseCommandChain — sudo detection", () => {
  it("detects sudo prefix", () => {
    const chain = parseCommandChain("sudo apt install curl");
    expect(chain.commands[0].hasSudo).toBe(true);
    expect(chain.commands[0].executable).toBe("apt");
    expect(chain.commands[0].args).toEqual(["install", "curl"]);
  });

  it("detects sudo with flags", () => {
    const chain = parseCommandChain("sudo -E npm install");
    expect(chain.commands[0].hasSudo).toBe(true);
    expect(chain.commands[0].executable).toBe("npm");
  });

  it("does not flag non-sudo commands", () => {
    const chain = parseCommandChain("npm install");
    expect(chain.commands[0].hasSudo).toBe(false);
  });

  it("detects sudo in chained commands", () => {
    const chain = parseCommandChain("echo ready && sudo reboot");
    expect(chain.commands[0].hasSudo).toBe(false);
    expect(chain.commands[1].hasSudo).toBe(true);
    expect(chain.commands[1].executable).toBe("reboot");
  });
});

// ============================================================================
// Redirect Detection
// ============================================================================

describe("parseCommandChain — redirect detection", () => {
  it("detects > redirect", () => {
    const chain = parseCommandChain("echo hello > output.txt");
    expect(chain.commands[0].hasRedirect).toBe(true);
    expect(chain.commands[0].executable).toBe("echo");
  });

  it("detects >> append redirect", () => {
    const chain = parseCommandChain("echo line >> log.txt");
    expect(chain.commands[0].hasRedirect).toBe(true);
  });

  it("detects < input redirect", () => {
    const chain = parseCommandChain("sort < input.txt");
    expect(chain.commands[0].hasRedirect).toBe(true);
  });

  it("detects 2> stderr redirect", () => {
    const chain = parseCommandChain("cmd 2> /dev/null");
    expect(chain.commands[0].hasRedirect).toBe(true);
  });

  it("does not detect redirect in quoted strings", () => {
    const chain = parseCommandChain("echo '> not a redirect'");
    expect(chain.commands[0].hasRedirect).toBe(false);
  });
});

// ============================================================================
// Subshell Detection
// ============================================================================

describe("parseCommandChain — subshell detection", () => {
  it("detects $(...) subshell", () => {
    const chain = parseCommandChain("echo $(whoami)");
    expect(chain.commands[0].isSubshell).toBe(true);
  });

  it("detects backtick subshell", () => {
    const chain = parseCommandChain("echo `date`");
    expect(chain.commands[0].isSubshell).toBe(true);
  });

  it("does not detect subshell in normal commands", () => {
    const chain = parseCommandChain("echo hello");
    expect(chain.commands[0].isSubshell).toBe(false);
  });

  it("does not detect $() inside single quotes", () => {
    const chain = parseCommandChain("echo '$(not a subshell)'");
    expect(chain.commands[0].isSubshell).toBe(false);
  });
});

// ============================================================================
// Environment Variable Prefixes
// ============================================================================

describe("parseCommandChain — environment variable prefixes", () => {
  it("skips env prefix and finds real executable", () => {
    const chain = parseCommandChain("FOO=bar node script.js");
    expect(chain.commands[0].executable).toBe("node");
    expect(chain.commands[0].args).toEqual(["script.js"]);
  });

  it("handles multiple env prefixes", () => {
    const chain = parseCommandChain("FOO=1 BAR=2 python main.py");
    expect(chain.commands[0].executable).toBe("python");
    expect(chain.commands[0].args).toEqual(["main.py"]);
  });

  it("treats command without env prefix normally", () => {
    const chain = parseCommandChain("node --version");
    expect(chain.commands[0].executable).toBe("node");
    expect(chain.commands[0].args).toEqual(["--version"]);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("parseCommandChain — edge cases", () => {
  it("handles empty input", () => {
    const chain = parseCommandChain("");
    expect(chain.commands).toHaveLength(0);
    expect(chain.raw).toBe("");
  });

  it("handles whitespace-only input", () => {
    const chain = parseCommandChain("   ");
    expect(chain.commands).toHaveLength(0);
  });

  it("handles a complex real-world command", () => {
    const chain = parseCommandChain(
      'git add -A && git commit -m "feat: add feature" && git push origin main',
    );
    expect(chain.commands).toHaveLength(3);
    expect(chain.commands[0].executable).toBe("git");
    expect(chain.commands[1].executable).toBe("git");
    expect(chain.commands[2].executable).toBe("git");
  });

  it("handles pipe-to-shell pattern", () => {
    const chain = parseCommandChain("curl https://example.com/install.sh | bash");
    expect(chain.commands).toHaveLength(2);
    expect(chain.commands[0].executable).toBe("curl");
    expect(chain.commands[1].executable).toBe("bash");
    expect(chain.commands[1].isPiped).toBe(true);
  });

  it("handles command with only redirects", () => {
    const chain = parseCommandChain("cat < input.txt > output.txt");
    expect(chain.commands[0].executable).toBe("cat");
    expect(chain.commands[0].hasRedirect).toBe(true);
  });

  it("handles sudo with env prefix", () => {
    const chain = parseCommandChain("DEBIAN_FRONTEND=noninteractive sudo apt-get install -y curl");
    expect(chain.commands[0].hasSudo).toBe(true);
    expect(chain.commands[0].executable).toBe("apt-get");
  });

  it("handles trailing semicolons", () => {
    const chain = parseCommandChain("echo hello;");
    expect(chain.commands).toHaveLength(1);
    expect(chain.commands[0].executable).toBe("echo");
  });
});
