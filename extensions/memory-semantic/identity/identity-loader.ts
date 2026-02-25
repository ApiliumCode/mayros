/**
 * Loads agent identity from the Cortex graph with fallback to MAYROS.md.
 * Provides formatting helpers for system prompt injection.
 */

import { readFile } from "node:fs/promises";
import type { CortexClient } from "../cortex-client.js";
import {
  type AgentIdentity,
  emptyIdentity,
  identityToTriples,
  mayrosMdToIdentity,
  triplesToIdentity,
} from "./identity-graph.js";

export class IdentityLoader {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly mayrosMdPath: string,
  ) {}

  /**
   * Load identity from Cortex. On failure, fallback to MAYROS.md parsing.
   */
  async loadIdentity(agentId: string): Promise<AgentIdentity> {
    // Try Cortex first
    try {
      const subj = `${this.ns}:agent:${agentId}`;
      const result = await this.client.listTriples({
        subject: subj,
        limit: 100,
      });

      // Filter to identity predicates only
      const identityTriples = result.triples.filter((t) => t.predicate.includes(":identity:"));

      if (identityTriples.length > 0) {
        return triplesToIdentity(agentId, identityTriples);
      }
    } catch {
      // Cortex unavailable, fall through to MAYROS.md
    }

    // Fallback: parse MAYROS.md
    return this.loadFromMarkdown(agentId);
  }

  /**
   * Parse MAYROS.md into a partial identity and fill defaults.
   */
  async loadFromMarkdown(agentId: string): Promise<AgentIdentity> {
    try {
      const content = await readFile(this.mayrosMdPath, "utf-8");
      const partial = mayrosMdToIdentity(content);
      return {
        ...emptyIdentity(agentId),
        ...partial,
      };
    } catch {
      return emptyIdentity(agentId);
    }
  }

  /**
   * One-way sync: parse MAYROS.md and push identity triples to Cortex.
   */
  async syncFromMarkdown(agentId: string): Promise<number> {
    const identity = await this.loadFromMarkdown(agentId);
    const triples = identityToTriples(this.ns, identity);

    let created = 0;
    for (const t of triples) {
      try {
        await this.client.createTriple(t);
        created++;
      } catch {
        // skip duplicates or errors
      }
    }

    return created;
  }

  /**
   * Format identity for injection into the system prompt.
   */
  formatForSystemPrompt(identity: AgentIdentity): string {
    const parts: string[] = [];

    parts.push(`<agent-identity>`);
    parts.push(`Name: ${identity.name}`);

    if (identity.personality) {
      parts.push(`Personality: ${identity.personality}`);
    }

    if (identity.capabilities.length > 0) {
      parts.push(`Capabilities: ${identity.capabilities.join(", ")}`);
    }

    if (identity.permissions.length > 0) {
      parts.push(`Permissions: ${identity.permissions.join(", ")}`);
    }

    if (identity.languages.length > 0) {
      parts.push(`Languages: ${identity.languages.join(", ")}`);
    }

    const traitEntries = Object.entries(identity.traits);
    if (traitEntries.length > 0) {
      for (const [key, value] of traitEntries) {
        parts.push(`${key}: ${value}`);
      }
    }

    parts.push(`</agent-identity>`);
    return parts.join("\n");
  }
}
