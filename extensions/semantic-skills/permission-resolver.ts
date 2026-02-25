import type { SemanticSkillManifest, SemanticPermission } from "./skill-manifest.js";

export type PermissionCheck = {
  allowed: boolean;
  reason?: string;
};

export type OperationKind =
  | "graph:read"
  | "graph:write"
  | "proofs:request"
  | "proofs:verify"
  | "proofs:publish"
  | "memory:recall"
  | "memory:remember";

const SEMANTIC_TOOLS = new Set([
  "skill_graph_query",
  "skill_assert",
  "skill_verify_assertion",
  "skill_request_zk_proof",
  "skill_verify_zk_proof",
  "skill_memory_context",
]);

export class PermissionResolver {
  private permissions: SemanticPermission;
  private skillName: string;
  private allowedTools?: string[];

  constructor(manifest: SemanticSkillManifest, skillName: string) {
    this.permissions = manifest.permissions;
    this.skillName = skillName;
    this.allowedTools = manifest.allowedTools;
  }

  /**
   * Check whether a tool is allowed by this skill's allowlist.
   * Semantic tools are always allowed (when permissions match).
   * `["*"]` in allowedTools = unrestricted (opt-in escape hatch).
   * If no allowedTools is set, all tools are allowed (backward compat for non-semantic skills).
   */
  isToolAllowed(toolName: string): boolean {
    if (SEMANTIC_TOOLS.has(toolName)) return true;
    if (!this.allowedTools) return true;
    if (this.allowedTools.includes("*")) return true;
    return this.allowedTools.includes(toolName);
  }

  check(operation: OperationKind): PermissionCheck {
    const [domain, action] = operation.split(":") as [keyof SemanticPermission, string];

    const allowed = this.permissions[domain] as string[];
    if (!allowed || !allowed.includes(action)) {
      return {
        allowed: false,
        reason: `Skill "${this.skillName}" lacks permission: ${operation}`,
      };
    }

    return { allowed: true };
  }

  checkAll(operations: OperationKind[]): PermissionCheck {
    for (const op of operations) {
      const result = this.check(op);
      if (!result.allowed) {
        return result;
      }
    }
    return { allowed: true };
  }

  hasPermission(operation: OperationKind): boolean {
    return this.check(operation).allowed;
  }

  /** Returns all granted permissions as a flat list. */
  listGranted(): OperationKind[] {
    const granted: OperationKind[] = [];
    for (const perm of this.permissions.graph) {
      granted.push(`graph:${perm}` as OperationKind);
    }
    for (const perm of this.permissions.proofs) {
      granted.push(`proofs:${perm}` as OperationKind);
    }
    for (const perm of this.permissions.memory) {
      granted.push(`memory:${perm}` as OperationKind);
    }
    return granted;
  }
}

/** Map tool names to the operations they require. */
export function requiredPermissions(toolName: string): OperationKind[] {
  switch (toolName) {
    case "skill_graph_query":
      return ["graph:read"];
    case "skill_assert":
      return ["graph:write"];
    case "skill_verify_assertion":
      return ["graph:read", "proofs:verify"];
    case "skill_request_zk_proof":
      return ["proofs:request"];
    case "skill_verify_zk_proof":
      return ["proofs:verify"];
    case "skill_memory_context":
      return ["memory:recall"];
    default:
      return [];
  }
}
