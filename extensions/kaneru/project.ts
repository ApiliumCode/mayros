/**
 * Project Manager
 *
 * Projects group missions within a venture with an owner, target date,
 * category, and team. Projects sit between ventures (the organization)
 * and missions (the work units).
 *
 * All stored as Cortex RDF triples.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "cancelled";

export type Project = {
  id: string;
  name: string;
  ventureId: string;
  owner: string | null;
  status: ProjectStatus;
  targetDate: string | null;
  category: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCreateOpts = {
  name: string;
  ventureId: string;
  owner?: string;
  targetDate?: string;
  category?: string;
  description?: string;
};

// ============================================================================
// Helpers
// ============================================================================

function projectSubject(ns: string, id: string): string {
  return `${ns}:project:${id}`;
}

function projectPredicate(ns: string, field: string): string {
  return `${ns}:project:${field}`;
}

function parseProjectTriples(
  ns: string,
  projectId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): Project | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:project:`;

  for (const t of triples) {
    const pred = stripBrackets(String(t.predicate));
    if (pred.startsWith(prefix)) {
      const val =
        typeof t.object === "object" && t.object !== null && "node" in (t.object as Record<string, unknown>)
          ? stripBrackets(String((t.object as { node: string }).node))
          : String(t.object);
      fields[pred.slice(prefix.length)] = val;
    }
  }

  if (!fields.name) return null;

  const venturePrefix = `${ns}:venture:`;
  let ventureId = fields.ventureId ?? "";
  if (ventureId.startsWith(venturePrefix)) ventureId = ventureId.slice(venturePrefix.length);

  return {
    id: projectId,
    name: fields.name,
    ventureId,
    owner: fields.owner ?? null,
    status: (fields.status as ProjectStatus) ?? "planning",
    targetDate: fields.targetDate ?? null,
    category: fields.category ?? "general",
    description: fields.description ?? "",
    createdAt: fields.createdAt ?? "",
    updatedAt: fields.updatedAt ?? "",
  };
}

// ============================================================================
// ProjectManager
// ============================================================================

export class ProjectManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Create a new project within a venture. */
  async create(opts: ProjectCreateOpts): Promise<Project> {
    if (!opts.name.trim()) throw new Error("Project name is required");
    if (!opts.ventureId.trim()) throw new Error("Venture ID is required");

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = projectSubject(this.ns, id);

    const fields: Array<[string, string | { node: string }]> = [
      ["name", sanitizeTripleValue(opts.name)],
      ["ventureId", { node: `${this.ns}:venture:${opts.ventureId}` }],
      ["status", "planning"],
      ["category", sanitizeTripleValue(opts.category ?? "general")],
      ["description", sanitizeTripleValue(opts.description ?? "")],
      ["createdAt", now],
      ["updatedAt", now],
    ];

    if (opts.owner) fields.push(["owner", sanitizeTripleValue(opts.owner)]);
    if (opts.targetDate) fields.push(["targetDate", opts.targetDate]);

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: projectPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      name: opts.name,
      ventureId: opts.ventureId,
      owner: opts.owner ?? null,
      status: "planning",
      targetDate: opts.targetDate ?? null,
      category: opts.category ?? "general",
      description: opts.description ?? "",
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Get a project by ID. */
  async get(id: string): Promise<Project | null> {
    const subject = projectSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 30 });
    return parseProjectTriples(this.ns, id, result.triples);
  }

  /** List projects for a venture. */
  async list(ventureId: string): Promise<Project[]> {
    const ventureNode = `${this.ns}:venture:${ventureId}`;
    const result = await this.client.patternQuery({
      predicate: projectPredicate(this.ns, "ventureId"),
      object: { node: ventureNode },
      limit: 200,
    });

    const projects: Project[] = [];
    const prefix = `${this.ns}:project:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const project = await this.get(id);
      if (project) projects.push(project);
    }

    return projects;
  }

  /** Update project fields. */
  async update(id: string, patch: Partial<Pick<Project, "name" | "owner" | "status" | "targetDate" | "category" | "description">>): Promise<Project> {
    const project = await this.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);

    const subject = projectSubject(this.ns, id);
    const now = new Date().toISOString();

    const updates: Array<[string, string]> = [["updatedAt", now]];
    if (patch.name !== undefined) updates.push(["name", sanitizeTripleValue(patch.name)]);
    if (patch.owner !== undefined) updates.push(["owner", sanitizeTripleValue(patch.owner ?? "")]);
    if (patch.status !== undefined) updates.push(["status", patch.status]);
    if (patch.targetDate !== undefined) updates.push(["targetDate", patch.targetDate]);
    if (patch.category !== undefined) updates.push(["category", sanitizeTripleValue(patch.category)]);
    if (patch.description !== undefined) updates.push(["description", sanitizeTripleValue(patch.description)]);

    for (const [field, value] of updates) {
      const existing = await this.client.listTriples({
        subject,
        predicate: projectPredicate(this.ns, field),
        limit: 1,
      });
      for (const t of existing.triples) {
        if (t.id) await this.client.deleteTriple(t.id);
      }
      await this.client.createTriple({
        subject,
        predicate: projectPredicate(this.ns, field),
        object: value,
      });
    }

    return (await this.get(id))!;
  }

  /** Mark a project as completed. */
  async complete(id: string): Promise<void> {
    await this.update(id, { status: "completed" });
  }
}
