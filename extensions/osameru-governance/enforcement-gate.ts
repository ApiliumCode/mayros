import type { PolicyBundle, PolicyRule, PolicyAction } from "./policy-compiler.js";
import type { TrustTier } from "./trust-tiers.js";

export type GateContext = {
  kind: "tool" | "agent" | "content";
  toolName?: string;
  params?: Record<string, unknown>;
  agentId?: string;
  content?: string;
  trustTier?: TrustTier;
};

export type GateDecision = {
  action: PolicyAction | "allow";
  reason?: string;
  matchedRule?: PolicyRule;
};

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(value);
  }
  return value === pattern || value.startsWith(pattern);
}

export class EnforcementGate {
  private sortedRules: PolicyRule[];

  constructor(private bundle: PolicyBundle) {
    this.sortedRules = this.sortByPriority(bundle.rules);
  }

  updateBundle(bundle: PolicyBundle): void {
    this.bundle = bundle;
    this.sortedRules = this.sortByPriority(bundle.rules);
  }

  private sortByPriority(rules: PolicyRule[]): PolicyRule[] {
    return [...rules].sort((a, b) => b.priority - a.priority);
  }

  evaluate(context: GateContext): GateDecision {
    for (const rule of this.sortedRules) {
      // Check trust tier minimum
      if (rule.trustTierMinimum !== undefined && context.trustTier !== undefined) {
        if (context.trustTier < rule.trustTierMinimum) continue;
      }

      if (context.kind === "tool" && context.toolName) {
        if (rule.toolPatterns) {
          const matches = rule.toolPatterns.some((p) => matchesPattern(context.toolName!, p));
          if (matches) {
            return {
              action: rule.action,
              reason: `Rule ${rule.id}: tool ${context.toolName}`,
              matchedRule: rule,
            };
          }
        }
        if (rule.commandPatterns && context.params?.command) {
          const cmd = `${context.params.command as string}`;
          const matches = rule.commandPatterns.some((p) => matchesPattern(cmd, p));
          if (matches) {
            return {
              action: rule.action,
              reason: `Rule ${rule.id}: command match`,
              matchedRule: rule,
            };
          }
        }
      }

      if (context.kind === "agent" && context.agentId) {
        if (rule.agentIds) {
          const matches = rule.agentIds.some((id) => matchesPattern(context.agentId!, id));
          if (matches) {
            return {
              action: rule.action,
              reason: `Rule ${rule.id}: agent ${context.agentId}`,
              matchedRule: rule,
            };
          }
        }
      }

      if (context.kind === "tool" && rule.filePatterns && context.params) {
        const filePath = (context.params.path ??
          context.params.file_path ??
          context.params.filePath) as string | undefined;
        if (filePath) {
          const matches = rule.filePatterns.some((p) => matchesPattern(filePath, p));
          if (matches) {
            return {
              action: rule.action,
              reason: `Rule ${rule.id}: file pattern match`,
              matchedRule: rule,
            };
          }
        }
      }
    }

    return { action: this.bundle.globalDefaults.defaultAction };
  }
}
