/**
 * Dependency Auditor
 *
 * Scans skill content against a simplified set of security rules
 * (inspired by src/security/skill-scanner.ts) and audits transitive
 * dependencies fetched from the Hub.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type AuditSeverity = "info" | "warning" | "error" | "critical";

export type AuditFinding = {
  slug: string;
  version: string;
  severity: AuditSeverity;
  rule: string;
  message: string;
  file?: string;
};

export type AuditReport = {
  slug: string;
  version: string;
  totalDependencies: number;
  findings: AuditFinding[];
  scannedAt: string;
  passed: boolean;
};

// ============================================================================
// Security scan rules (simplified from skill-scanner.ts 16-rule set)
// ============================================================================

type ScanRule = {
  id: string;
  severity: AuditSeverity;
  message: string;
  pattern: RegExp;
};

const SCAN_RULES: ScanRule[] = [
  {
    id: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
  },
  {
    id: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected (eval/Function)",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    id: "suspicious-network",
    severity: "warning",
    message: "Network access detected (fetch/http/net)",
    pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bhttp\.request\s*\(|\bnet\.connect\s*\(/,
  },
  {
    id: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /\bxmrig\b|\bcoinhive\b|stratum\+tcp/i,
  },
  {
    id: "obfuscated-code",
    severity: "error",
    message: "Obfuscated code detected (excessive hex escapes or long base64)",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}|[A-Za-z0-9+/=]{200,}/,
  },
  {
    id: "env-harvesting",
    severity: "error",
    message: "Environment variable harvesting detected",
    pattern: /Object\.keys\s*\(\s*process\.env\s*\)|Object\.entries\s*\(\s*process\.env\s*\)/,
  },
  {
    id: "dynamic-import",
    severity: "error",
    message: "Dynamic import() with non-literal argument",
    pattern: /\bimport\s*\(\s*[^"'`\s)]/,
  },
  {
    id: "global-this-access",
    severity: "warning",
    message: "globalThis bracket access detected (possible sandbox escape)",
    pattern: /\bglobalThis\s*\[/,
  },
];

const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
]);

// ============================================================================
// Hub client interface
// ============================================================================

type HubClientLike = {
  getSkill: (slug: string) => Promise<{
    version: string;
    dependencies?: { slug: string; version: string }[];
  }>;
  download: (slug: string, version?: string) => Promise<Buffer>;
};

// ============================================================================
// DependencyAuditor
// ============================================================================

export class DependencyAuditor {
  /**
   * Scan a single file's content against security rules.
   * Returns findings for any rule that matches.
   */
  scanContent(content: string, filename: string): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const rule of SCAN_RULES) {
      if (rule.pattern.test(content)) {
        findings.push({
          slug: "",
          version: "",
          severity: rule.severity,
          rule: rule.id,
          message: rule.message,
          file: filename,
        });
      }
    }

    return findings;
  }

  /**
   * Audit a skill and its transitive dependencies.
   * Scans local files in skillDir and resolves transitive deps via hubClient.
   */
  async auditSkill(slug: string, skillDir: string, hubClient: HubClientLike): Promise<AuditReport> {
    const findings: AuditFinding[] = [];
    const scannedAt = new Date().toISOString();

    // Read skill version from SKILL.md
    let version = "unknown";
    try {
      const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
      const versionMatch = skillMd.match(/skillVersion:\s*["']?(\d+\.\d+\.\d+[^\s"']*)["']?/);
      if (versionMatch?.[1]) {
        version = versionMatch[1];
      }
    } catch {
      // SKILL.md not found; continue with "unknown"
    }

    // Scan local files
    const localFindings = await this.scanDirectory(skillDir, slug, version);
    findings.push(...localFindings);

    // Resolve transitive dependencies count
    let totalDependencies = 0;
    try {
      const info = await hubClient.getSkill(slug);
      const deps = info.dependencies ?? [];
      totalDependencies = deps.length;
    } catch {
      // Hub lookup failed, no dependency info
    }

    const hasCritical = findings.some((f) => f.severity === "critical");

    return {
      slug,
      version,
      totalDependencies,
      findings,
      scannedAt,
      passed: !hasCritical,
    };
  }

  /**
   * Audit all installed skills in a directory.
   */
  async auditAll(skillsDir: string, hubClient: HubClientLike): Promise<AuditReport[]> {
    const reports: AuditReport[] = [];

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return reports;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(skillsDir, entry.name);

      // Only audit dirs with SKILL.md
      try {
        await readFile(join(skillDir, "SKILL.md"), "utf-8");
      } catch {
        continue;
      }

      const report = await this.auditSkill(entry.name, skillDir, hubClient);
      reports.push(report);
    }

    return reports;
  }

  /**
   * Recursively scan all scannable files in a directory.
   */
  private async scanDirectory(dir: string, slug: string, version: string): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return findings;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const subFindings = await this.scanDirectory(fullPath, slug, version);
        findings.push(...subFindings);
      } else if (SCANNABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const fileFindings = this.scanContent(content, entry.name);
          for (const f of fileFindings) {
            f.slug = slug;
            f.version = version;
          }
          findings.push(...fileFindings);
        } catch {
          // File read failed, skip
        }
      }
    }

    return findings;
  }
}
