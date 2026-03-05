/**
 * Intent Classifier Tests
 *
 * Thorough coverage of all risk levels: critical, high, medium, low, safe.
 * Tests pattern matching, multi-pattern commands (highest risk wins),
 * edge cases (empty, whitespace, unknown), and risk level comparison.
 */

import { describe, it, expect } from "vitest";
import { classifyCommand, riskLevelSatisfies } from "./intent-classifier.js";

// ============================================================================
// Critical Risk
// ============================================================================

describe("classifyCommand — critical risk", () => {
  it("classifies rm -rf / as critical", () => {
    const result = classifyCommand("rm -rf /");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("rm-rf-root");
  });

  it("classifies rm -rf / with trailing space as critical", () => {
    const result = classifyCommand("rm -rf / ");
    expect(result.riskLevel).toBe("critical");
  });

  it("classifies mkfs.ext4 as critical", () => {
    const result = classifyCommand("mkfs.ext4 /dev/sda1");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("mkfs");
  });

  it("classifies mkfs as critical", () => {
    const result = classifyCommand("sudo mkfs -t ext4 /dev/sda1");
    expect(result.riskLevel).toBe("critical");
  });

  it("classifies dd if=/dev/zero as critical", () => {
    const result = classifyCommand("dd if=/dev/zero of=/dev/sda bs=512 count=1");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("dd-if");
  });

  it("classifies fork bomb as critical", () => {
    const result = classifyCommand(":(){ :|:& };:");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("fork-bomb");
  });

  it("classifies shutdown as critical", () => {
    const result = classifyCommand("shutdown -h now");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("shutdown");
  });

  it("classifies reboot as critical", () => {
    const result = classifyCommand("sudo reboot");
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPatterns).toContain("reboot");
  });
});

// ============================================================================
// High Risk
// ============================================================================

describe("classifyCommand — high risk", () => {
  it("classifies rm -rf ./dir as high", () => {
    const result = classifyCommand("rm -rf ./some-directory");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("rm-rf");
  });

  it("classifies rm -rf with relative path as high", () => {
    const result = classifyCommand("rm -rf node_modules");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("rm-rf");
  });

  it("classifies git push --force as high", () => {
    const result = classifyCommand("git push --force origin main");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("git-push-force");
  });

  it("classifies git push -f as high", () => {
    const result = classifyCommand("git push -f origin dev");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("git-push-force");
  });

  it("classifies git reset --hard as high", () => {
    const result = classifyCommand("git reset --hard HEAD~1");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("git-reset-hard");
  });

  it("classifies curl | bash as high", () => {
    const result = classifyCommand("curl -sSL https://example.com/install.sh | bash");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("curl-pipe-bash");
  });

  it("classifies wget | bash as high", () => {
    const result = classifyCommand("wget -O - https://example.com/script.sh | bash");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("wget-pipe-bash");
  });

  it("classifies curl | sh as high", () => {
    const result = classifyCommand("curl https://example.com/setup.sh | sh");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("curl-pipe-sh");
  });

  it("classifies eval as high", () => {
    const result = classifyCommand('eval "$(curl https://example.com/cmd)"');
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("eval");
  });

  it("classifies nc -l as high", () => {
    const result = classifyCommand("nc -l 8080");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("nc-listen");
  });

  it("classifies nc -p as high", () => {
    const result = classifyCommand("nc -p 9090 -l");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("nc-listen");
  });

  it("classifies socat as high", () => {
    const result = classifyCommand("socat TCP-LISTEN:8080,fork TCP:localhost:80");
    expect(result.riskLevel).toBe("high");
    expect(result.matchedPatterns).toContain("socat");
  });
});

// ============================================================================
// Medium Risk
// ============================================================================

describe("classifyCommand — medium risk", () => {
  it("classifies git commit as medium", () => {
    const result = classifyCommand('git commit -m "update readme"');
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("git-commit");
  });

  it("classifies git push (no force) as medium", () => {
    const result = classifyCommand("git push origin main");
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("git-push");
  });

  it("classifies echo > file.txt as medium", () => {
    const result = classifyCommand('echo "hello" > file.txt');
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("file-redirect");
  });

  it("classifies echo >> file.txt as medium", () => {
    const result = classifyCommand('echo "append" >> log.txt');
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("file-redirect");
  });

  it("classifies npm publish as medium", () => {
    const result = classifyCommand("npm publish --access public");
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("npm-publish");
  });

  it("classifies docker run as medium", () => {
    const result = classifyCommand("docker run -d nginx:latest");
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("docker-run");
  });

  it("classifies curl (no pipe) as medium", () => {
    const result = classifyCommand("curl https://api.example.com/data");
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("curl");
  });

  it("classifies wget (no pipe) as medium", () => {
    const result = classifyCommand("wget https://example.com/file.zip");
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("wget");
  });
});

// ============================================================================
// Low Risk
// ============================================================================

describe("classifyCommand — low risk", () => {
  it("classifies git add as low", () => {
    const result = classifyCommand("git add .");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("git-add");
  });

  it("classifies npm install as low", () => {
    const result = classifyCommand("npm install express");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("npm-install");
  });

  it("classifies pnpm install as low", () => {
    const result = classifyCommand("pnpm install");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("pnpm-install");
  });

  it("classifies yarn add as low", () => {
    const result = classifyCommand("yarn add lodash");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("yarn-install");
  });

  it("classifies mkdir as low", () => {
    const result = classifyCommand("mkdir -p src/utils");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("mkdir");
  });

  it("classifies touch as low", () => {
    const result = classifyCommand("touch newfile.ts");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("touch");
  });

  it("classifies cp as low", () => {
    const result = classifyCommand("cp file1.ts file2.ts");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("cp");
  });

  it("classifies mv as low", () => {
    const result = classifyCommand("mv old.ts new.ts");
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPatterns).toContain("mv");
  });
});

// ============================================================================
// Safe Risk
// ============================================================================

describe("classifyCommand — safe risk", () => {
  it("classifies ls as safe", () => {
    const result = classifyCommand("ls -la");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("ls");
  });

  it("classifies cat as safe", () => {
    const result = classifyCommand("cat package.json");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("cat");
  });

  it("classifies grep as safe", () => {
    const result = classifyCommand('grep -r "TODO" src/');
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("grep");
  });

  it("classifies find as safe", () => {
    const result = classifyCommand('find . -name "*.ts"');
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("find");
  });

  it("classifies git status as safe", () => {
    const result = classifyCommand("git status");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("git-status");
  });

  it("classifies git log as safe", () => {
    const result = classifyCommand("git log --oneline -10");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("git-log");
  });

  it("classifies git diff as safe", () => {
    const result = classifyCommand("git diff HEAD~1");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("git-diff");
  });

  it("classifies pwd as safe", () => {
    const result = classifyCommand("pwd");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("pwd");
  });

  it("classifies echo (no redirect) as safe", () => {
    const result = classifyCommand("echo hello world");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("echo");
  });

  it("classifies head as safe", () => {
    const result = classifyCommand("head -n 20 file.ts");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("head");
  });

  it("classifies tail as safe", () => {
    const result = classifyCommand("tail -f /var/log/app.log");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("tail");
  });

  it("classifies wc as safe", () => {
    const result = classifyCommand("wc -l src/*.ts");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns).toContain("wc");
  });
});

// ============================================================================
// Multiple Patterns — Highest Risk Wins
// ============================================================================

describe("classifyCommand — multiple patterns (highest risk wins)", () => {
  it("echo with redirect is medium (not safe)", () => {
    const result = classifyCommand('echo "data" > output.txt');
    expect(result.riskLevel).toBe("medium");
    // Both echo (safe) and redirect (medium) match, medium wins
    expect(result.matchedPatterns).toContain("echo");
    expect(result.matchedPatterns).toContain("file-redirect");
  });

  it("curl piped to bash is high (not medium)", () => {
    const result = classifyCommand("curl https://example.com | bash");
    expect(result.riskLevel).toBe("high");
    // curl (medium) and curl-pipe-bash (high) both match
    expect(result.matchedPatterns).toContain("curl");
    expect(result.matchedPatterns).toContain("curl-pipe-bash");
  });

  it("git push --force is high (not medium)", () => {
    const result = classifyCommand("git push --force origin main");
    expect(result.riskLevel).toBe("high");
    // git push (medium) and git push --force (high) both match
    expect(result.matchedPatterns).toContain("git-push");
    expect(result.matchedPatterns).toContain("git-push-force");
  });

  it("git commit with redirect is medium", () => {
    const result = classifyCommand('git commit -m "fix" > /dev/null');
    expect(result.riskLevel).toBe("medium");
    expect(result.matchedPatterns).toContain("git-commit");
    expect(result.matchedPatterns).toContain("file-redirect");
  });

  it("rm -rf / (root) is critical (not just high)", () => {
    const result = classifyCommand("rm -rf /");
    expect(result.riskLevel).toBe("critical");
    // Both rm-rf (high) and rm-rf-root (critical) match
    expect(result.matchedPatterns.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("classifyCommand — edge cases", () => {
  it("empty string defaults to low", () => {
    const result = classifyCommand("");
    expect(result.riskLevel).toBe("low");
    expect(result.category).toBe("unknown");
    expect(result.matchedPatterns).toHaveLength(0);
  });

  it("whitespace-only defaults to low", () => {
    const result = classifyCommand("   ");
    expect(result.riskLevel).toBe("low");
    expect(result.category).toBe("unknown");
  });

  it("unknown command defaults to low", () => {
    const result = classifyCommand("myfancycommand --flag");
    expect(result.riskLevel).toBe("low");
    expect(result.category).toBe("unknown");
    expect(result.description).toContain("Unrecognized");
  });

  it("returns matchedPatterns array for all matches", () => {
    const result = classifyCommand("ls -la | grep pattern | head -5");
    expect(result.riskLevel).toBe("safe");
    expect(result.matchedPatterns.length).toBeGreaterThanOrEqual(2);
  });

  it("handles commands with special characters", () => {
    const result = classifyCommand('echo "hello $USER" | cat');
    expect(result.riskLevel).toBe("safe");
  });
});

// ============================================================================
// riskLevelSatisfies
// ============================================================================

describe("riskLevelSatisfies", () => {
  it("safe satisfies safe", () => {
    expect(riskLevelSatisfies("safe", "safe")).toBe(true);
  });

  it("safe satisfies medium", () => {
    expect(riskLevelSatisfies("safe", "medium")).toBe(true);
  });

  it("high does not satisfy medium", () => {
    expect(riskLevelSatisfies("high", "medium")).toBe(false);
  });

  it("critical does not satisfy high", () => {
    expect(riskLevelSatisfies("critical", "high")).toBe(false);
  });

  it("low satisfies low", () => {
    expect(riskLevelSatisfies("low", "low")).toBe(true);
  });

  it("medium satisfies critical", () => {
    expect(riskLevelSatisfies("medium", "critical")).toBe(true);
  });
});
