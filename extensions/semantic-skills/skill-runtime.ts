import type { CortexClient } from "./cortex-client.js";
import type { SemanticSkillManifest } from "./skill-manifest.js";

export type SkillContextEntry = {
  predicate: string;
  matches: Array<{ subject: string; object: unknown }>;
};

export type SkillRuntimeContext = {
  skillName: string;
  manifest: SemanticSkillManifest;
  contextEntries: SkillContextEntry[];
};

/**
 * Pre-fetches declared queries from the graph and builds
 * a `<semantic-skill-context>` block for injection into the prompt.
 */
export async function buildSkillContext(
  client: CortexClient,
  namespace: string,
  agentId: string,
  skillName: string,
  manifest: SemanticSkillManifest,
): Promise<SkillRuntimeContext> {
  const contextEntries: SkillContextEntry[] = [];

  for (const queryDecl of manifest.queries) {
    const nsPredicate = queryDecl.predicate.startsWith(`${namespace}:`)
      ? queryDecl.predicate
      : `${namespace}:${queryDecl.predicate}`;

    // Scope subject based on declared scope
    let subject: string | undefined;
    if (queryDecl.scope === "agent") {
      subject = `${namespace}:agent:${agentId}`;
    } else if (queryDecl.scope === "namespace") {
      // Query within namespace — no subject constraint but prefix expected
      subject = undefined;
    }
    // "global" — no subject filter

    try {
      const result = await client.patternQuery({
        subject,
        predicate: nsPredicate,
        limit: 20,
      });

      if (result.matches.length > 0) {
        contextEntries.push({
          predicate: queryDecl.predicate,
          matches: result.matches.map((m) => ({
            subject: m.subject,
            object: m.object,
          })),
        });
      }
    } catch {
      // Query failed — skip this predicate, non-fatal
    }
  }

  return { skillName, manifest, contextEntries };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formats the runtime context as an XML block for prompt injection.
 */
export function formatSkillContextXml(ctx: SkillRuntimeContext): string {
  if (ctx.contextEntries.length === 0) {
    return "";
  }

  const lines: string[] = [`<semantic-skill-context skill="${ctx.skillName}">`];

  for (const entry of ctx.contextEntries) {
    lines.push(`  <query predicate="${entry.predicate}" count="${entry.matches.length}">`);
    for (const match of entry.matches) {
      const objStr = typeof match.object === "string" ? match.object : JSON.stringify(match.object);
      lines.push(`    <result subject="${escapeXml(match.subject)}">${escapeXml(objStr)}</result>`);
    }
    lines.push("  </query>");
  }

  lines.push("</semantic-skill-context>");
  return lines.join("\n");
}
