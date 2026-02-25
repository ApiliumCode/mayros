export type SemanticPermission = {
  graph: Array<"read" | "write">;
  proofs: Array<"request" | "verify" | "publish">;
  memory: Array<"recall" | "remember">;
};

export type SemanticAssertionDecl = {
  predicate: string;
  requireProof: boolean;
};

export type SemanticQueryDecl = {
  predicate: string;
  scope: "agent" | "namespace" | "global";
};

export type SkillDependency = {
  slug: string;
  version: string; // semver range
};

export type SemanticSkillManifest = {
  version: number;
  permissions: SemanticPermission;
  assertions: SemanticAssertionDecl[];
  queries: SemanticQueryDecl[];
  allowedTools?: string[];
  maxQueries?: number;
  skillVersion?: string; // semver version for this skill
  dependencies?: SkillDependency[];
};

const VALID_GRAPH_PERMS = new Set(["read", "write"]);
const VALID_PROOF_PERMS = new Set(["request", "verify", "publish"]);
const VALID_MEMORY_PERMS = new Set(["recall", "remember"]);
const VALID_SCOPES = new Set(["agent", "namespace", "global"]);

/**
 * Default restrictive allowlist applied when a semantic skill does not declare `allowedTools`.
 * Covers the 6 semantic tools + safe hub/mesh tools.
 * Skills that need broader access must explicitly declare `allowedTools` (or `["*"]` for unrestricted).
 */
export const DEFAULT_ALLOWED_TOOLS = [
  "skill_graph_query",
  "skill_assert",
  "skill_verify_assertion",
  "skill_request_zk_proof",
  "skill_verify_zk_proof",
  "skill_memory_context",
  "hub_search",
  "hub_verify",
  "mesh_request_knowledge",
];

export function parseSemanticManifest(
  frontmatter: Record<string, string>,
): SemanticSkillManifest | undefined {
  // Skill must have type: semantic
  const skillType = frontmatter.type;
  if (skillType !== "semantic") {
    return undefined;
  }

  // The 'semantic' block is YAML-parsed into the frontmatter
  const semanticRaw = frontmatter.semantic;
  if (!semanticRaw) {
    return undefined;
  }

  let parsed: Record<string, unknown>;
  if (typeof semanticRaw === "string") {
    // Should not happen after proper YAML parse, but handle gracefully
    try {
      parsed = JSON.parse(semanticRaw);
    } catch {
      return undefined;
    }
  } else {
    parsed = semanticRaw as unknown as Record<string, unknown>;
  }

  const version = typeof parsed.version === "number" ? parsed.version : 1;

  // Parse permissions
  const permissionsRaw = (parsed.permissions ?? {}) as Record<string, unknown>;
  const graphPerms = parseStringArray(permissionsRaw.graph).filter((p) =>
    VALID_GRAPH_PERMS.has(p),
  ) as SemanticPermission["graph"];
  const proofPerms = parseStringArray(permissionsRaw.proofs).filter((p) =>
    VALID_PROOF_PERMS.has(p),
  ) as SemanticPermission["proofs"];
  const memoryPerms = parseStringArray(permissionsRaw.memory).filter((p) =>
    VALID_MEMORY_PERMS.has(p),
  ) as SemanticPermission["memory"];

  // Parse assertions
  const assertionsRaw = Array.isArray(parsed.assertions) ? parsed.assertions : [];
  const assertions: SemanticAssertionDecl[] = [];
  for (const a of assertionsRaw) {
    if (typeof a === "object" && a !== null && typeof a.predicate === "string") {
      assertions.push({
        predicate: a.predicate,
        requireProof: a.requireProof === true,
      });
    }
  }

  // Parse queries
  const queriesRaw = Array.isArray(parsed.queries) ? parsed.queries : [];
  const queries: SemanticQueryDecl[] = [];
  for (const q of queriesRaw) {
    if (typeof q === "object" && q !== null && typeof q.predicate === "string") {
      const scope = VALID_SCOPES.has(q.scope) ? q.scope : "agent";
      queries.push({ predicate: q.predicate, scope });
    }
  }

  // Parse allowedTools — apply default restrictive allowlist for semantic skills
  const allowedToolsRaw = parseStringArray(parsed.allowedTools);
  let allowedTools: string[] | undefined;
  if (allowedToolsRaw.length > 0) {
    // Explicit declaration: use as-is. ["*"] = unrestricted escape hatch.
    allowedTools = allowedToolsRaw;
  } else if (parsed.allowedTools === undefined || parsed.allowedTools === null) {
    // No declaration → apply default restrictive allowlist
    allowedTools = [...DEFAULT_ALLOWED_TOOLS];
  } else {
    // Explicit empty array → apply default (empty array = "I want defaults")
    allowedTools = [...DEFAULT_ALLOWED_TOOLS];
  }

  // Parse maxQueries
  const maxQueries =
    typeof parsed.maxQueries === "number" ? Math.floor(parsed.maxQueries) : undefined;

  // Parse skillVersion (semver string)
  const skillVersion = typeof parsed.skillVersion === "string" ? parsed.skillVersion : undefined;

  // Parse dependencies
  const depsRaw = Array.isArray(parsed.dependencies) ? parsed.dependencies : [];
  const dependencies: SkillDependency[] = [];
  for (const d of depsRaw) {
    if (
      typeof d === "object" &&
      d !== null &&
      typeof d.slug === "string" &&
      typeof d.version === "string"
    ) {
      dependencies.push({ slug: d.slug, version: d.version });
    }
  }

  return {
    version,
    permissions: { graph: graphPerms, proofs: proofPerms, memory: memoryPerms },
    assertions,
    queries,
    allowedTools,
    maxQueries,
    skillVersion,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
  };
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string");
  }
  return [];
}

export function validateManifest(manifest: SemanticSkillManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (manifest.version < 1) {
    errors.push("semantic.version must be >= 1");
  }

  // Assertions with requireProof must have proof permissions
  const hasProofRequest = manifest.permissions.proofs.includes("request");
  for (const assertion of manifest.assertions) {
    if (assertion.requireProof && !hasProofRequest) {
      errors.push(
        `assertion "${assertion.predicate}" requires proof but skill lacks proofs:request permission`,
      );
    }
  }

  // Queries must have graph:read
  if (manifest.queries.length > 0 && !manifest.permissions.graph.includes("read")) {
    errors.push("queries declared but skill lacks graph:read permission");
  }

  // Assertions require graph:write
  if (manifest.assertions.length > 0 && !manifest.permissions.graph.includes("write")) {
    errors.push("assertions declared but skill lacks graph:write permission");
  }

  // maxQueries must be positive if specified
  if (manifest.maxQueries !== undefined && manifest.maxQueries < 1) {
    errors.push("maxQueries must be >= 1");
  }

  // skillVersion must be valid semver if specified
  if (manifest.skillVersion !== undefined) {
    if (!/^\d+\.\d+\.\d+/.test(manifest.skillVersion)) {
      errors.push(`skillVersion "${manifest.skillVersion}" is not valid semver`);
    }
  }

  // dependencies must have valid version ranges
  if (manifest.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!dep.slug || dep.slug.length === 0) {
        errors.push("dependency slug cannot be empty");
      }
      if (!dep.version || dep.version.length === 0) {
        errors.push(`dependency "${dep.slug}" has empty version range`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
