import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DependencyAuditor, type AuditFinding, type AuditReport } from "./dependency-audit.js";

// ============================================================================
// Helpers
// ============================================================================

let tmpDirs: string[] = [];

async function createTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
  tmpDirs.push(dir);
  return dir;
}

async function writeSkillFiles(
  dir: string,
  slug: string,
  version: string,
  code: string,
): Promise<string> {
  const skillDir = path.join(dir, slug);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${slug}\nskillVersion: "${version}"\n---\n# ${slug}\n`,
    "utf-8",
  );
  await fs.writeFile(path.join(skillDir, "skill.ts"), code, "utf-8");
  return skillDir;
}

function mockHubClient(
  skills: Record<string, { version: string; dependencies?: { slug: string; version: string }[] }>,
) {
  return {
    getSkill: async (slug: string) => {
      const s = skills[slug];
      if (!s) throw new Error(`not found: ${slug}`);
      return s;
    },
    download: async (_slug: string, _version?: string) => Buffer.from("archive"),
  };
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ============================================================================
// scanContent tests — one per rule
// ============================================================================

describe("DependencyAuditor.scanContent", () => {
  const auditor = new DependencyAuditor();

  it("detects dangerous-exec", () => {
    const findings = auditor.scanContent('const r = exec("ls")', "a.ts");
    expect(findings.some((f) => f.rule === "dangerous-exec")).toBe(true);
  });

  it("detects execSync", () => {
    const findings = auditor.scanContent('execSync("ls")', "a.ts");
    expect(findings.some((f) => f.rule === "dangerous-exec")).toBe(true);
  });

  it("detects spawn", () => {
    const findings = auditor.scanContent('spawn("node")', "a.ts");
    expect(findings.some((f) => f.rule === "dangerous-exec")).toBe(true);
  });

  it("detects dynamic-code-execution (eval)", () => {
    const findings = auditor.scanContent('eval("code")', "a.ts");
    expect(findings.some((f) => f.rule === "dynamic-code-execution")).toBe(true);
  });

  it("detects dynamic-code-execution (new Function)", () => {
    const findings = auditor.scanContent('new Function("return 1")', "a.ts");
    expect(findings.some((f) => f.rule === "dynamic-code-execution")).toBe(true);
  });

  it("detects suspicious-network (fetch)", () => {
    const findings = auditor.scanContent('fetch("https://evil.com")', "a.ts");
    expect(findings.some((f) => f.rule === "suspicious-network")).toBe(true);
  });

  it("detects suspicious-network (http.request)", () => {
    const findings = auditor.scanContent('http.request("http://example.com")', "a.ts");
    expect(findings.some((f) => f.rule === "suspicious-network")).toBe(true);
  });

  it("detects suspicious-network (XMLHttpRequest)", () => {
    const findings = auditor.scanContent("new XMLHttpRequest()", "a.ts");
    expect(findings.some((f) => f.rule === "suspicious-network")).toBe(true);
  });

  it("detects crypto-mining (xmrig)", () => {
    const findings = auditor.scanContent("// xmrig pool", "a.ts");
    expect(findings.some((f) => f.rule === "crypto-mining")).toBe(true);
  });

  it("detects crypto-mining (coinhive)", () => {
    const findings = auditor.scanContent("coinhive.start()", "a.ts");
    expect(findings.some((f) => f.rule === "crypto-mining")).toBe(true);
  });

  it("detects crypto-mining (stratum+tcp)", () => {
    const findings = auditor.scanContent('"stratum+tcp://pool.example.com"', "a.ts");
    expect(findings.some((f) => f.rule === "crypto-mining")).toBe(true);
  });

  it("detects obfuscated-code (hex escapes)", () => {
    const hex = "\\x48\\x65\\x6c\\x6c\\x6f\\x57\\x6f\\x72\\x6c\\x64";
    const findings = auditor.scanContent(`const s = "${hex}"`, "a.ts");
    expect(findings.some((f) => f.rule === "obfuscated-code")).toBe(true);
  });

  it("detects obfuscated-code (long base64)", () => {
    const b64 = "A".repeat(210);
    const findings = auditor.scanContent(`const data = "${b64}"`, "a.ts");
    expect(findings.some((f) => f.rule === "obfuscated-code")).toBe(true);
  });

  it("detects env-harvesting", () => {
    const findings = auditor.scanContent("Object.keys(process.env)", "a.ts");
    expect(findings.some((f) => f.rule === "env-harvesting")).toBe(true);
  });

  it("detects env-harvesting (entries)", () => {
    const findings = auditor.scanContent("Object.entries(process.env)", "a.ts");
    expect(findings.some((f) => f.rule === "env-harvesting")).toBe(true);
  });

  it("detects dynamic-import", () => {
    const findings = auditor.scanContent("import(variable)", "a.ts");
    expect(findings.some((f) => f.rule === "dynamic-import")).toBe(true);
  });

  it("detects global-this-access", () => {
    const findings = auditor.scanContent('globalThis["eval"]', "a.ts");
    expect(findings.some((f) => f.rule === "global-this-access")).toBe(true);
  });

  it("returns no findings for clean code", () => {
    const findings = auditor.scanContent(
      'const x = 1;\nconst y = "hello";\nexport default { x, y };',
      "clean.ts",
    );
    expect(findings).toHaveLength(0);
  });

  it("returns multiple findings for code with multiple issues", () => {
    const code = 'eval("x"); exec("ls"); globalThis["y"]';
    const findings = auditor.scanContent(code, "multi.ts");
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });

  it("sets severity correctly on critical findings", () => {
    const findings = auditor.scanContent('eval("x")', "a.ts");
    const evalFinding = findings.find((f) => f.rule === "dynamic-code-execution");
    expect(evalFinding?.severity).toBe("critical");
  });
});

// ============================================================================
// auditSkill tests
// ============================================================================

describe("DependencyAuditor.auditSkill", () => {
  const auditor = new DependencyAuditor();

  it("produces a passing report for clean skill", async () => {
    const dir = await createTmpDir();
    const skillDir = await writeSkillFiles(dir, "clean-skill", "1.0.0", "export const x = 1;\n");

    const hub = mockHubClient({ "clean-skill": { version: "1.0.0" } });
    const report = await auditor.auditSkill("clean-skill", skillDir, hub);

    expect(report.passed).toBe(true);
    expect(report.slug).toBe("clean-skill");
    expect(report.version).toBe("1.0.0");
    expect(report.findings).toHaveLength(0);
    expect(report.scannedAt).toBeTruthy();
  });

  it("produces a failing report for skill with critical finding", async () => {
    const dir = await createTmpDir();
    const skillDir = await writeSkillFiles(dir, "bad-skill", "1.0.0", 'eval("malicious")');

    const hub = mockHubClient({ "bad-skill": { version: "1.0.0" } });
    const report = await auditor.auditSkill("bad-skill", skillDir, hub);

    expect(report.passed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0].rule).toBe("dynamic-code-execution");
  });

  it("counts transitive dependencies", async () => {
    const dir = await createTmpDir();
    const skillDir = await writeSkillFiles(dir, "with-deps", "1.0.0", "export const x = 1;\n");

    const hub = mockHubClient({
      "with-deps": {
        version: "1.0.0",
        dependencies: [
          { slug: "dep-a", version: "^1.0.0" },
          { slug: "dep-b", version: "^2.0.0" },
        ],
      },
    });
    const report = await auditor.auditSkill("with-deps", skillDir, hub);

    expect(report.totalDependencies).toBe(2);
  });

  it("handles missing SKILL.md gracefully", async () => {
    const dir = await createTmpDir();
    const skillDir = path.join(dir, "no-manifest");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "skill.ts"), "export const x = 1;\n", "utf-8");

    const hub = mockHubClient({});
    const report = await auditor.auditSkill("no-manifest", skillDir, hub);

    expect(report.version).toBe("unknown");
    expect(report.passed).toBe(true);
  });
});

// ============================================================================
// auditAll tests
// ============================================================================

describe("DependencyAuditor.auditAll", () => {
  const auditor = new DependencyAuditor();

  it("audits all skills in directory", async () => {
    const dir = await createTmpDir();
    await writeSkillFiles(dir, "skill-a", "1.0.0", "export const a = 1;\n");
    await writeSkillFiles(dir, "skill-b", "2.0.0", 'eval("x")');

    const hub = mockHubClient({
      "skill-a": { version: "1.0.0" },
      "skill-b": { version: "2.0.0" },
    });

    const reports = await auditor.auditAll(dir, hub);
    expect(reports).toHaveLength(2);

    const a = reports.find((r) => r.slug === "skill-a");
    expect(a?.passed).toBe(true);

    const b = reports.find((r) => r.slug === "skill-b");
    expect(b?.passed).toBe(false);
  });

  it("skips directories without SKILL.md", async () => {
    const dir = await createTmpDir();
    await writeSkillFiles(dir, "valid", "1.0.0", "export const x = 1;\n");
    await fs.mkdir(path.join(dir, "not-a-skill"), { recursive: true });
    await fs.writeFile(path.join(dir, "not-a-skill", "random.txt"), "hello", "utf-8");

    const hub = mockHubClient({ valid: { version: "1.0.0" } });
    const reports = await auditor.auditAll(dir, hub);
    expect(reports).toHaveLength(1);
    expect(reports[0].slug).toBe("valid");
  });

  it("returns empty for nonexistent directory", async () => {
    const hub = mockHubClient({});
    const reports = await auditor.auditAll("/nonexistent-audit-dir", hub);
    expect(reports).toHaveLength(0);
  });
});
