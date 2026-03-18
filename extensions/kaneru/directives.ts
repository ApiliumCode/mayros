/**
 * Directive Manager
 *
 * Manages directive trees for ventures — cascading objectives that
 * flow down the chain of command. Each directive is stored as
 * Cortex RDF triples.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type DirectiveLevel = "strategic" | "objective" | "task";
export type DirectiveStatus = "active" | "completed" | "cancelled";

export type Directive = {
  id: string;
  title: string;
  description: string;
  level: DirectiveLevel;
  status: DirectiveStatus;
  ventureId: string;
  parentId: string | null;
  createdAt: string;
};

export type DirectiveCreateOpts = {
  title: string;
  description?: string;
  level?: DirectiveLevel;
  ventureId: string;
  parentId?: string;
};

export type DirectiveTree = {
  directive: Directive;
  children: DirectiveTree[];
};

// ============================================================================
// Helpers
// ============================================================================

function directiveSubject(ns: string, id: string): string {
  return `${ns}:directive:${id}`;
}

function directivePredicate(ns: string, field: string): string {
  return `${ns}:directive:${field}`;
}

function parseDirectiveTriples(
  ns: string,
  directiveId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): Directive | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:directive:`;

  for (const t of triples) {
    const pred = stripBrackets(String(t.predicate));
    if (pred.startsWith(prefix)) {
      const field = pred.slice(prefix.length);
      const val =
        typeof t.object === "object" && t.object !== null && "node" in (t.object as Record<string, unknown>)
          ? stripBrackets(String((t.object as { node: string }).node))
          : String(t.object);
      fields[field] = val;
    }
  }

  if (!fields.title) return null;

  // Extract venture ID from node reference
  const venturePrefix = `${ns}:venture:`;
  let ventureId = fields.venture ?? "";
  if (ventureId.startsWith(venturePrefix)) ventureId = ventureId.slice(venturePrefix.length);

  // Extract parent ID from node reference
  const dirPrefix = `${ns}:directive:`;
  let parentId: string | null = fields.parent ?? null;
  if (parentId?.startsWith(dirPrefix)) parentId = parentId.slice(dirPrefix.length);

  return {
    id: directiveId,
    title: fields.title,
    description: fields.description ?? "",
    level: (fields.level as DirectiveLevel) ?? "task",
    status: (fields.status as DirectiveStatus) ?? "active",
    ventureId,
    parentId,
    createdAt: fields.createdAt ?? "",
  };
}

// ============================================================================
// DirectiveManager
// ============================================================================

export class DirectiveManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Create a new directive. */
  async create(opts: DirectiveCreateOpts): Promise<Directive> {
    if (!opts.title.trim()) throw new Error("Directive title is required");
    if (!opts.ventureId.trim()) throw new Error("Venture ID is required");

    // Validate parent exists if specified
    if (opts.parentId) {
      const parent = await this.get(opts.parentId);
      if (!parent) throw new Error(`Parent directive not found: ${opts.parentId}`);
    }

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = directiveSubject(this.ns, id);
    const level = opts.level ?? "task";

    const fields: Array<[string, string | number | { node: string }]> = [
      ["title", sanitizeTripleValue(opts.title)],
      ["description", sanitizeTripleValue(opts.description ?? "")],
      ["level", level],
      ["status", "active"],
      ["venture", { node: `${this.ns}:venture:${opts.ventureId}` }],
      ["createdAt", now],
    ];

    if (opts.parentId) {
      fields.push(["parent", { node: directiveSubject(this.ns, opts.parentId) }]);
    }

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: directivePredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      title: opts.title,
      description: opts.description ?? "",
      level,
      status: "active",
      ventureId: opts.ventureId,
      parentId: opts.parentId ?? null,
      createdAt: now,
    };
  }

  /** Get a directive by ID. */
  async get(id: string): Promise<Directive | null> {
    const subject = directiveSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 50 });
    return parseDirectiveTriples(this.ns, id, result.triples);
  }

  /** List all directives for a venture. */
  async list(ventureId: string): Promise<Directive[]> {
    const ventureNode = `${this.ns}:venture:${ventureId}`;
    const result = await this.client.patternQuery({
      predicate: directivePredicate(this.ns, "venture"),
      object: { node: ventureNode },
      limit: 500,
    });

    const directives: Directive[] = [];
    const prefix = `${this.ns}:directive:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const directive = await this.get(id);
      if (directive) directives.push(directive);
    }

    return directives;
  }

  /** Build directive tree for a venture. */
  async tree(ventureId: string): Promise<DirectiveTree[]> {
    const all = await this.list(ventureId);
    return this.buildTree(all);
  }

  /** Update directive status. */
  async updateStatus(id: string, status: DirectiveStatus): Promise<void> {
    const directive = await this.get(id);
    if (!directive) throw new Error(`Directive not found: ${id}`);

    const subject = directiveSubject(this.ns, id);

    // Delete old status triple
    const existing = await this.client.listTriples({
      subject,
      predicate: directivePredicate(this.ns, "status"),
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Write new status
    await this.client.createTriple({
      subject,
      predicate: directivePredicate(this.ns, "status"),
      object: status,
    });
  }

  /** Build tree from flat directive list. */
  private buildTree(directives: Directive[]): DirectiveTree[] {
    const nodeMap = new Map<string, DirectiveTree>();

    for (const d of directives) {
      nodeMap.set(d.id, { directive: d, children: [] });
    }

    const roots: DirectiveTree[] = [];
    for (const node of nodeMap.values()) {
      const parentId = node.directive.parentId;
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
