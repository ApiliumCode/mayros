import fs from "node:fs/promises";

export type PolicyAction = "allow" | "deny" | "require-approval";
export type PolicyCategory = "tool" | "file" | "network" | "budget" | "content" | "agent";

export type PolicyRule = {
  id: string;
  source: string;
  category: PolicyCategory;
  action: PolicyAction;
  toolPatterns?: string[];
  filePatterns?: string[];
  commandPatterns?: string[];
  domainPatterns?: string[];
  agentIds?: string[];
  priority: number;
  trustTierMinimum?: number;
};

export type PolicyBundle = {
  version: string;
  compiledAt: string;
  rules: PolicyRule[];
  globalDefaults: { defaultAction: PolicyAction };
};

export type PolicySource = {
  path: string;
  content: string;
};

const RULE_PATTERN = /^-\s+(ALLOW|DENY|REQUIRE-APPROVAL):\s*(.+)$/i;
const JSON_BLOCK_PATTERN = /```json\s*\n([\s\S]*?)```/g;

function parseRuleLine(line: string, source: string, index: number): PolicyRule | null {
  const match = line.match(RULE_PATTERN);
  if (!match) return null;

  const actionMap: Record<string, PolicyAction> = {
    ALLOW: "allow",
    DENY: "deny",
    "REQUIRE-APPROVAL": "require-approval",
  };
  const action = actionMap[match[1]!.toUpperCase()]!;
  const body = match[2]!.trim();

  const rule: PolicyRule = {
    id: `${source}:${index}`,
    source,
    category: "tool",
    action,
    priority: action === "deny" ? 100 : action === "require-approval" ? 50 : 10,
  };

  // Parse body for patterns
  const toolMatch = body.match(/tools?\s*[:=]\s*(.+)/i);
  if (toolMatch) {
    rule.category = "tool";
    rule.toolPatterns = toolMatch[1]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return rule;
  }

  const fileMatch = body.match(/files?\s*[:=]\s*(.+)/i);
  if (fileMatch) {
    rule.category = "file";
    rule.filePatterns = fileMatch[1]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return rule;
  }

  const cmdMatch = body.match(/commands?\s*[:=]\s*(.+)/i);
  if (cmdMatch) {
    rule.category = "tool";
    rule.commandPatterns = cmdMatch[1]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return rule;
  }

  const domainMatch = body.match(/domains?\s*[:=]\s*(.+)/i);
  if (domainMatch) {
    rule.category = "network";
    rule.domainPatterns = domainMatch[1]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return rule;
  }

  const agentMatch = body.match(/agents?\s*[:=]\s*(.+)/i);
  if (agentMatch) {
    rule.category = "agent";
    rule.agentIds = agentMatch[1]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return rule;
  }

  // Generic rule — treat body as tool pattern
  rule.toolPatterns = [body];
  return rule;
}

function parseJsonRules(json: string, source: string): PolicyRule[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: Record<string, unknown>, i: number) => ({
      id: `${source}:json:${i}`,
      source,
      category: (r.category as PolicyCategory) ?? "tool",
      action: (r.action as PolicyAction) ?? "deny",
      toolPatterns: Array.isArray(r.toolPatterns) ? r.toolPatterns : undefined,
      filePatterns: Array.isArray(r.filePatterns) ? r.filePatterns : undefined,
      commandPatterns: Array.isArray(r.commandPatterns) ? r.commandPatterns : undefined,
      domainPatterns: Array.isArray(r.domainPatterns) ? r.domainPatterns : undefined,
      agentIds: Array.isArray(r.agentIds) ? r.agentIds : undefined,
      priority: typeof r.priority === "number" ? r.priority : 50,
      trustTierMinimum: typeof r.trustTierMinimum === "number" ? r.trustTierMinimum : undefined,
    }));
  } catch {
    return [];
  }
}

const MAX_POLICY_FILE_SIZE = 1_048_576; // 1MB

export class PolicyCompiler {
  compile(sources: PolicySource[]): PolicyBundle {
    const rules: PolicyRule[] = [];

    for (const source of sources) {
      let inPolicySection = false;
      let inSecuritySection = false;
      let ruleIndex = 0;

      // Extract JSON blocks first
      let match: RegExpExecArray | null;
      const jsonPattern = new RegExp(JSON_BLOCK_PATTERN.source, "g");
      while ((match = jsonPattern.exec(source.content)) !== null) {
        rules.push(...parseJsonRules(match[1]!, source.path));
      }

      // Parse line by line
      const lines = source.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();

        // Detect sections
        if (/^#{1,3}\s+(?:Policies|Policy)/i.test(trimmed)) {
          inPolicySection = true;
          inSecuritySection = false;
          continue;
        }
        if (/^#{1,3}\s+Security/i.test(trimmed)) {
          inSecuritySection = true;
          inPolicySection = false;
          continue;
        }
        if (
          /^#{1,3}\s+/.test(trimmed) &&
          !trimmed.match(/^#{1,3}\s+(?:Policies|Policy|Security)/i)
        ) {
          inPolicySection = false;
          inSecuritySection = false;
          continue;
        }

        if (inPolicySection || inSecuritySection) {
          const rule = parseRuleLine(trimmed, source.path, ruleIndex++);
          if (rule) rules.push(rule);
        }
      }
    }

    // Sort by priority (highest first)
    rules.sort((a, b) => b.priority - a.priority);

    return {
      version: "1.0",
      compiledAt: new Date().toISOString(),
      rules,
      globalDefaults: { defaultAction: "allow" },
    };
  }

  async compileFromPaths(paths: string[], baseDir: string): Promise<PolicyBundle> {
    const sources: PolicySource[] = [];
    const path = await import("node:path");

    for (const p of paths) {
      const resolved = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
      try {
        const stat = await fs.stat(resolved);
        if (stat.size > MAX_POLICY_FILE_SIZE) {
          console.warn(
            `osameru: skipping policy file ${p} — exceeds 1MB size limit (${stat.size} bytes)`,
          );
          continue;
        }
        const content = await fs.readFile(resolved, "utf-8");
        sources.push({ path: p, content });
      } catch {
        // File not found — skip silently
      }
    }

    return this.compile(sources);
  }
}
