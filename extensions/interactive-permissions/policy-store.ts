/**
 * Permission Policy Store.
 *
 * Stores and retrieves permission policies from AIngle Cortex (when available)
 * or falls back to in-memory storage. Policies determine whether tool calls
 * should be automatically allowed, denied, or require user confirmation.
 *
 * Supports three matcher types:
 *   - exact: literal string match
 *   - glob:  simple wildcards (* matches any, ? matches single char)
 *   - regex: full regular expression
 */

import type { CortexClientLike } from "../shared/cortex-client.js";
import type { RiskLevel } from "./intent-classifier.js";
import { riskLevelSatisfies } from "./intent-classifier.js";
import {
  isWildcardExpression,
  parsePermissionWildcard,
  matchesWildcardPermission,
} from "./wildcard-matcher.js";

// ============================================================================
// Types
// ============================================================================

export type PermissionPolicyKind = "always_allow" | "always_deny" | "ask";

export type PermissionPolicy = {
  id: string;
  kind: PermissionPolicyKind;
  matcher: string;
  matcherType: "exact" | "glob" | "regex";
  toolKind?: string;
  commandPattern?: string;
  maxRiskLevel?: RiskLevel;
  createdAt: string;
  source: "manual" | "learned";
};

// ============================================================================
// Helpers
// ============================================================================

let policyCounter = 0;

export function generatePolicyId(): string {
  policyCounter++;
  return `policy-${Date.now()}-${policyCounter}`;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports * (any chars) and ? (single char).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withWildcards}$`);
}

/**
 * Check whether a value matches a policy's matcher.
 */
function matchesPolicy(value: string, policy: PermissionPolicy): boolean {
  switch (policy.matcherType) {
    case "exact":
      return value === policy.matcher;
    case "glob":
      return globToRegex(policy.matcher).test(value);
    case "regex":
      try {
        return new RegExp(policy.matcher).test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ============================================================================
// Policy Store
// ============================================================================

export class PolicyStore {
  private policies: Map<string, PermissionPolicy> = new Map();

  constructor(
    private cortex: CortexClientLike | undefined,
    private ns: string,
  ) {}

  // ---------- Cortex persistence ----------

  /**
   * Load stored policies from Cortex triples.
   * Each policy is stored as a set of triples under the subject
   * `${ns}:permission:policy:${id}`.
   */
  async loadFromCortex(): Promise<void> {
    if (!this.cortex) return;

    try {
      const result = await this.cortex.listTriples({
        predicate: `${this.ns}:permission:kind`,
        limit: 1000,
      });

      for (const triple of result.triples) {
        const subject = triple.subject;
        const idMatch = subject.match(/:policy:(.+)$/);
        if (!idMatch) continue;
        const id = idMatch[1];

        // Load all predicates for this policy
        const detail: {
          triples: Array<{
            subject: string;
            predicate: string;
            object: string | number | boolean | { node: string };
            id?: string;
          }>;
          total: number;
        } = await this.cortex.listTriples({
          subject,
          limit: 20,
        });

        const fields: Record<string, string> = {};
        for (const t of detail.triples) {
          const predParts: string[] = t.predicate.split(":");
          const key = predParts[predParts.length - 1];
          fields[key] = String(t.object);
        }

        if (!fields.kind || !fields.matcher || !fields.matcherType) continue;

        const policy: PermissionPolicy = {
          id,
          kind: fields.kind as PermissionPolicyKind,
          matcher: fields.matcher,
          matcherType: fields.matcherType as "exact" | "glob" | "regex",
          toolKind: fields.toolKind,
          commandPattern: fields.commandPattern,
          maxRiskLevel: fields.maxRiskLevel as RiskLevel | undefined,
          createdAt: fields.createdAt ?? new Date().toISOString(),
          source: (fields.source as "manual" | "learned") ?? "manual",
        };

        this.policies.set(id, policy);
      }
    } catch {
      // Cortex unavailable — continue with in-memory policies
    }
  }

  /**
   * Persist a policy to Cortex and store in memory.
   */
  async savePolicy(policy: PermissionPolicy): Promise<void> {
    this.policies.set(policy.id, policy);

    if (!this.cortex) return;

    const subject = `${this.ns}:permission:policy:${policy.id}`;
    const prefix = `${this.ns}:permission`;

    try {
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:kind`,
        object: policy.kind,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:matcher`,
        object: policy.matcher,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:matcherType`,
        object: policy.matcherType,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:createdAt`,
        object: policy.createdAt,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:source`,
        object: policy.source,
      });

      if (policy.toolKind) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:toolKind`,
          object: policy.toolKind,
        });
      }
      if (policy.commandPattern) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:commandPattern`,
          object: policy.commandPattern,
        });
      }
      if (policy.maxRiskLevel) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:maxRiskLevel`,
          object: policy.maxRiskLevel,
        });
      }
    } catch {
      // Cortex write failure — policy is still in memory
    }
  }

  /**
   * Remove a policy from memory and Cortex.
   */
  async removePolicy(id: string): Promise<void> {
    this.policies.delete(id);

    if (!this.cortex) return;

    const subject = `${this.ns}:permission:policy:${id}`;

    try {
      const result = await this.cortex.listTriples({ subject, limit: 20 });
      for (const triple of result.triples) {
        if (triple.id) {
          await this.cortex.deleteTriple(triple.id);
        }
      }
    } catch {
      // Cortex delete failure — policy already removed from memory
    }
  }

  /**
   * Find the first matching policy for a given tool call.
   *
   * Matching precedence:
   * 1. If matcher is a wildcard expression (e.g. "Bash(git:*)"), use wildcard matching
   * 2. If command is provided, match against commandPattern or matcher
   * 3. Match against toolName
   * 4. If policy has maxRiskLevel, only match if risk <= maxRiskLevel
   */
  findMatchingPolicy(
    toolName: string,
    command?: string,
    riskLevel?: RiskLevel,
    args?: Record<string, unknown>,
  ): PermissionPolicy | undefined {
    for (const policy of this.policies.values()) {
      // Check maxRiskLevel constraint
      if (policy.maxRiskLevel && riskLevel) {
        if (!riskLevelSatisfies(riskLevel, policy.maxRiskLevel)) {
          continue;
        }
      }

      // Check wildcard permission expressions (e.g. "Bash(git:*)")
      if (isWildcardExpression(policy.matcher)) {
        const parsed = parsePermissionWildcard(policy.matcher);
        if (parsed) {
          // Build args from explicit args param or synthesize from command
          const effectiveArgs: Record<string, unknown> = args ?? {};
          if (command && !effectiveArgs.command) {
            effectiveArgs.command = command;
          }
          if (matchesWildcardPermission(toolName, effectiveArgs, parsed)) {
            return policy;
          }
          continue; // Wildcard expression checked — skip legacy matching
        }
      }

      // Try matching against command first (more specific)
      if (command && policy.commandPattern) {
        const cmdPolicy = { ...policy, matcher: policy.commandPattern };
        if (matchesPolicy(command, cmdPolicy)) {
          return policy;
        }
      }

      // Match against tool name or general matcher
      if (matchesPolicy(toolName, policy)) {
        return policy;
      }

      // Try command against general matcher
      if (command && matchesPolicy(command, policy)) {
        return policy;
      }
    }

    return undefined;
  }

  /**
   * List all stored policies.
   */
  listPolicies(): PermissionPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get a policy by ID.
   */
  getPolicy(id: string): PermissionPolicy | undefined {
    return this.policies.get(id);
  }

  /**
   * Number of stored policies.
   */
  get size(): number {
    return this.policies.size;
  }
}
