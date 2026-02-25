/**
 * Maps agent identity to/from RDF triples in the Cortex graph.
 *
 * Identity triples use the pattern:
 *   {ns}:agent:{id}  {ns}:identity:{property}  "value"
 */

import type { CreateTripleRequest, TripleDto, ValueDto } from "../cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type AgentIdentity = {
  agentId: string;
  name: string;
  personality: string;
  capabilities: string[];
  permissions: string[];
  languages: string[];
  traits: Record<string, string>;
};

export function emptyIdentity(agentId: string): AgentIdentity {
  return {
    agentId,
    name: agentId,
    personality: "",
    capabilities: [],
    permissions: [],
    languages: [],
    traits: {},
  };
}

// ============================================================================
// Helpers
// ============================================================================

function agentSubject(ns: string, agentId: string): string {
  return `${ns}:agent:${agentId}`;
}

function identityPredicate(ns: string, prop: string): string {
  return `${ns}:identity:${prop}`;
}

function stringValue(v: ValueDto): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "node" in v) return v.node;
  return String(v);
}

// ============================================================================
// Identity → Triples
// ============================================================================

export function identityToTriples(ns: string, identity: AgentIdentity): CreateTripleRequest[] {
  const subj = agentSubject(ns, identity.agentId);
  const triples: CreateTripleRequest[] = [];

  triples.push({
    subject: subj,
    predicate: identityPredicate(ns, "name"),
    object: identity.name,
  });

  if (identity.personality) {
    triples.push({
      subject: subj,
      predicate: identityPredicate(ns, "personality"),
      object: identity.personality,
    });
  }

  for (const cap of identity.capabilities) {
    triples.push({
      subject: subj,
      predicate: identityPredicate(ns, "capability"),
      object: cap,
    });
  }

  for (const perm of identity.permissions) {
    triples.push({
      subject: subj,
      predicate: identityPredicate(ns, "permission"),
      object: perm,
    });
  }

  for (const lang of identity.languages) {
    triples.push({
      subject: subj,
      predicate: identityPredicate(ns, "language"),
      object: lang,
    });
  }

  for (const [key, value] of Object.entries(identity.traits)) {
    triples.push({
      subject: subj,
      predicate: identityPredicate(ns, `trait:${key}`),
      object: value,
    });
  }

  return triples;
}

// ============================================================================
// Triples → Identity
// ============================================================================

export function triplesToIdentity(agentId: string, triples: TripleDto[]): AgentIdentity {
  const identity = emptyIdentity(agentId);

  for (const t of triples) {
    const pred = t.predicate;
    const val = stringValue(t.object);

    if (pred.endsWith(":name")) {
      identity.name = val;
    } else if (pred.endsWith(":personality")) {
      identity.personality = val;
    } else if (pred.endsWith(":capability")) {
      identity.capabilities.push(val);
    } else if (pred.endsWith(":permission")) {
      identity.permissions.push(val);
    } else if (pred.endsWith(":language")) {
      identity.languages.push(val);
    } else if (pred.includes(":trait:")) {
      const traitKey = pred.split(":trait:")[1];
      if (traitKey) {
        identity.traits[traitKey] = val;
      }
    }
  }

  return identity;
}

// ============================================================================
// MAYROS.md → Identity
// ============================================================================

/**
 * Extract a partial identity from a MAYROS.md (or CLAUDE.md-style) file.
 * Looks for well-known headings and key-value patterns.
 */
export function mayrosMdToIdentity(markdown: string): Partial<AgentIdentity> {
  const identity: Partial<AgentIdentity> = {};
  const lines = markdown.split("\n");

  let currentSection = "";

  for (const raw of lines) {
    const line = raw.trim();

    // Section heading
    if (/^#{1,3}\s/.test(line)) {
      currentSection = line.replace(/^#+\s*/, "").toLowerCase();
      continue;
    }

    // Agent name from first line or "name:" field
    const nameMatch = line.match(/^name:\s*(.+)/i);
    if (nameMatch) {
      identity.name = nameMatch[1].trim();
      continue;
    }

    // Personality
    if (currentSection.includes("personality") || currentSection.includes("persona")) {
      if (line.length > 3 && !identity.personality) {
        identity.personality = line;
      }
      continue;
    }

    // Capabilities
    if (currentSection.includes("capabilit")) {
      if (/^[-*]\s/.test(line)) {
        if (!identity.capabilities) identity.capabilities = [];
        identity.capabilities.push(line.replace(/^[-*]\s+/, ""));
      }
      continue;
    }

    // Permissions
    if (currentSection.includes("permission")) {
      if (/^[-*]\s/.test(line)) {
        if (!identity.permissions) identity.permissions = [];
        identity.permissions.push(line.replace(/^[-*]\s+/, ""));
      }
      continue;
    }

    // Languages
    if (currentSection.includes("language")) {
      if (/^[-*]\s/.test(line)) {
        if (!identity.languages) identity.languages = [];
        identity.languages.push(line.replace(/^[-*]\s+/, ""));
      }
      continue;
    }
  }

  return identity;
}
