import type { Skill } from "@earendil-works/pi-coding-agent";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import {
  getFrontmatterString,
  normalizeStringList,
  parseMayrosManifestInstallBase,
  parseFrontmatterBool,
  resolveMayrosManifestBlock,
  resolveMayrosManifestInstall,
  resolveMayrosManifestOs,
  resolveMayrosManifestRequires,
} from "../../shared/frontmatter.js";
import type {
  MayrosSkillMetadata,
  ParsedSkillFrontmatter,
  SemanticSkillManifest,
  SkillEntry,
  SkillInstallSpec,
  SkillInvocationPolicy,
} from "./types.js";

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  const parsed = parseMayrosManifestInstallBase(input, ["brew", "node", "go", "uv", "download"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec: SkillInstallSpec = {
    kind: parsed.kind as SkillInstallSpec["kind"],
  };

  if (parsed.id) {
    spec.id = parsed.id;
  }
  if (parsed.label) {
    spec.label = parsed.label;
  }
  if (parsed.bins) {
    spec.bins = parsed.bins;
  }
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  const formula = typeof raw.formula === "string" ? raw.formula.trim() : "";
  if (formula) {
    spec.formula = formula;
  }
  const cask = typeof raw.cask === "string" ? raw.cask.trim() : "";
  if (!spec.formula && cask) {
    spec.formula = cask;
  }
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.module === "string") {
    spec.module = raw.module;
  }
  if (typeof raw.url === "string") {
    spec.url = raw.url;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }

  return spec;
}

export function resolveMayrosMetadata(
  frontmatter: ParsedSkillFrontmatter,
): MayrosSkillMetadata | undefined {
  const metadataObj = resolveMayrosManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  const requires = resolveMayrosManifestRequires(metadataObj);
  const install = resolveMayrosManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveMayrosManifestOs(metadataObj);
  // Detect semantic skill type
  const skillType = resolveSkillType(frontmatter);
  const semanticManifest =
    skillType === "semantic" ? resolveSemanticManifest(frontmatter) : undefined;

  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
    primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    requires: requires,
    install: install.length > 0 ? install : undefined,
    skillType,
    semanticManifest,
  };
}

function resolveSkillType(frontmatter: ParsedSkillFrontmatter): "classic" | "semantic" | undefined {
  const typeVal = getFrontmatterString(frontmatter, "type");
  if (typeVal === "semantic") return "semantic";
  if (typeVal === "classic") return "classic";
  return undefined;
}

const VALID_GRAPH_PERMS = new Set(["read", "write"]);
const VALID_PROOF_PERMS = new Set(["request", "verify", "publish"]);
const VALID_MEMORY_PERMS = new Set(["recall", "remember"]);
const VALID_SCOPES = new Set(["agent", "namespace", "global"]);

function resolveSemanticManifest(
  frontmatter: ParsedSkillFrontmatter,
): SemanticSkillManifest | undefined {
  const semanticRaw = frontmatter.semantic;
  if (!semanticRaw) return undefined;

  let parsed: Record<string, unknown>;
  if (typeof semanticRaw === "string") {
    try {
      parsed = JSON.parse(semanticRaw);
    } catch {
      return undefined;
    }
  } else {
    parsed = semanticRaw as unknown as Record<string, unknown>;
  }

  const version = typeof parsed.version === "number" ? parsed.version : 1;

  const permissionsRaw = (parsed.permissions ?? {}) as Record<string, unknown>;
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];

  const graphPerms = toStrArr(permissionsRaw.graph).filter((p) =>
    VALID_GRAPH_PERMS.has(p),
  ) as SemanticSkillManifest["permissions"]["graph"];
  const proofPerms = toStrArr(permissionsRaw.proofs).filter((p) =>
    VALID_PROOF_PERMS.has(p),
  ) as SemanticSkillManifest["permissions"]["proofs"];
  const memoryPerms = toStrArr(permissionsRaw.memory).filter((p) =>
    VALID_MEMORY_PERMS.has(p),
  ) as SemanticSkillManifest["permissions"]["memory"];

  const assertionsRaw = Array.isArray(parsed.assertions) ? parsed.assertions : [];
  const assertions: SemanticSkillManifest["assertions"] = [];
  for (const a of assertionsRaw) {
    if (typeof a === "object" && a !== null && typeof a.predicate === "string") {
      assertions.push({ predicate: a.predicate, requireProof: a.requireProof === true });
    }
  }

  const queriesRaw = Array.isArray(parsed.queries) ? parsed.queries : [];
  const queries: SemanticSkillManifest["queries"] = [];
  for (const q of queriesRaw) {
    if (typeof q === "object" && q !== null && typeof q.predicate === "string") {
      const scope = VALID_SCOPES.has(q.scope) ? q.scope : "agent";
      queries.push({ predicate: q.predicate, scope });
    }
  }

  return {
    version,
    permissions: { graph: graphPerms, proofs: proofPerms, memory: memoryPerms },
    assertions,
    queries,
  };
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterString(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterString(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
