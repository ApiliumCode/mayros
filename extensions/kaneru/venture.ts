/**
 * Venture Manager
 *
 * Cortex-backed venture lifecycle: create, list, update, and archive ventures.
 * Each venture is a set of RDF triples with a unique subject.
 *
 * Follows the PlanStore pattern: subject per venture, predicates for fields,
 * delete-then-create for updates.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type VentureStatus = "active" | "paused" | "archived";

export type Venture = {
  id: string;
  name: string;
  directive: string;
  fuelLimit: number;
  status: VentureStatus;
  prefix: string;
  missionCounter: number;
  createdAt: string;
  updatedAt: string;
};

export type VentureCreateOpts = {
  name: string;
  directive: string;
  fuelLimit?: number;
  prefix: string;
};

// ============================================================================
// Helpers
// ============================================================================

/** Strip angle brackets from Cortex RDF notation. `<foo:bar>` → `foo:bar` */
function stripBrackets(s: string): string {
  return s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
}

function ventureSubject(ns: string, id: string): string {
  return `${ns}:venture:${id}`;
}

function venturePredicate(ns: string, field: string): string {
  return `${ns}:venture:${field}`;
}

function parseVentureTriples(
  ns: string,
  ventureId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): Venture | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:venture:`;

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

  if (!fields.name) return null;

  return {
    id: ventureId,
    name: fields.name,
    directive: fields.directive ?? "",
    fuelLimit: parseInt(fields.fuelLimit ?? "0", 10),
    status: (fields.status as VentureStatus) ?? "active",
    prefix: fields.prefix ?? "",
    missionCounter: parseInt(fields.missionCounter ?? "0", 10),
    createdAt: fields.createdAt ?? "",
    updatedAt: fields.updatedAt ?? "",
  };
}

// ============================================================================
// VentureManager
// ============================================================================

export class VentureManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Create a new venture with a unique prefix. */
  async create(opts: VentureCreateOpts): Promise<Venture> {
    if (!opts.name.trim()) throw new Error("Venture name is required");
    if (!opts.prefix.trim()) throw new Error("Venture prefix is required");
    if (opts.prefix.length > 10) throw new Error("Venture prefix must be 10 characters or less");

    // Check prefix uniqueness
    const existing = await this.list();
    if (existing.some((v) => v.prefix.toUpperCase() === opts.prefix.toUpperCase())) {
      throw new Error(`Venture prefix "${opts.prefix}" is already in use`);
    }

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = ventureSubject(this.ns, id);

    const fields: Array<[string, string | number]> = [
      ["name", opts.name],
      ["directive", opts.directive],
      ["fuelLimit", opts.fuelLimit ?? 0],
      ["status", "active"],
      ["prefix", opts.prefix.toUpperCase()],
      ["missionCounter", 0],
      ["createdAt", now],
      ["updatedAt", now],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: venturePredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      name: opts.name,
      directive: opts.directive,
      fuelLimit: opts.fuelLimit ?? 0,
      status: "active",
      prefix: opts.prefix.toUpperCase(),
      missionCounter: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Get a venture by ID, reconstructing from triples. */
  async get(id: string): Promise<Venture | null> {
    const subject = ventureSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 50 });
    return parseVentureTriples(this.ns, id, result.triples);
  }

  /** List all ventures. */
  async list(): Promise<Venture[]> {
    const predicate = venturePredicate(this.ns, "name");
    const result = await this.client.patternQuery({ predicate, limit: 500 });

    const ventures: Venture[] = [];
    const prefix = `${this.ns}:venture:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const venture = await this.get(id);
      if (venture) ventures.push(venture);
    }

    return ventures;
  }

  /** Update venture fields. Delete-then-create for changed fields. */
  async update(id: string, patch: Partial<VentureCreateOpts>): Promise<Venture> {
    const venture = await this.get(id);
    if (!venture) throw new Error(`Venture not found: ${id}`);

    // Check prefix uniqueness if changing prefix
    if (patch.prefix !== undefined && patch.prefix.toUpperCase() !== venture.prefix) {
      const existing = await this.list();
      if (existing.some((v) => v.id !== id && v.prefix.toUpperCase() === patch.prefix!.toUpperCase())) {
        throw new Error(`Venture prefix "${patch.prefix}" is already in use`);
      }
    }

    const subject = ventureSubject(this.ns, id);
    const now = new Date().toISOString();

    const updates: Array<[string, string | number]> = [["updatedAt", now]];

    if (patch.name !== undefined) updates.push(["name", patch.name]);
    if (patch.directive !== undefined) updates.push(["directive", patch.directive]);
    if (patch.fuelLimit !== undefined) updates.push(["fuelLimit", patch.fuelLimit]);
    if (patch.prefix !== undefined) updates.push(["prefix", patch.prefix.toUpperCase()]);

    for (const [field, value] of updates) {
      // Delete old triple
      const existing = await this.client.listTriples({
        subject,
        predicate: venturePredicate(this.ns, field),
        limit: 1,
      });
      for (const t of existing.triples) {
        if (t.id) await this.client.deleteTriple(t.id);
      }

      // Create new triple
      await this.client.createTriple({
        subject,
        predicate: venturePredicate(this.ns, field),
        object: value,
      });
    }

    return (await this.get(id))!;
  }

  /** Archive a venture (soft-delete). */
  async archive(id: string): Promise<void> {
    const venture = await this.get(id);
    if (!venture) throw new Error(`Venture not found: ${id}`);

    const subject = ventureSubject(this.ns, id);

    // Update status to archived
    const existing = await this.client.listTriples({
      subject,
      predicate: venturePredicate(this.ns, "status"),
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject,
      predicate: venturePredicate(this.ns, "status"),
      object: "archived",
    });

    // Update timestamp
    const updatedTriples = await this.client.listTriples({
      subject,
      predicate: venturePredicate(this.ns, "updatedAt"),
      limit: 1,
    });
    for (const t of updatedTriples.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject,
      predicate: venturePredicate(this.ns, "updatedAt"),
      object: new Date().toISOString(),
    });
  }

  /**
   * Atomically increment mission counter and return next mission identifier.
   * Returns e.g. "SEC-1", "SEC-2".
   */
  async nextMissionId(ventureId: string): Promise<{ identifier: string; counter: number }> {
    const venture = await this.get(ventureId);
    if (!venture) throw new Error(`Venture not found: ${ventureId}`);

    const newCounter = venture.missionCounter + 1;
    const subject = ventureSubject(this.ns, ventureId);

    // Delete old counter
    const existing = await this.client.listTriples({
      subject,
      predicate: venturePredicate(this.ns, "missionCounter"),
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Write new counter
    await this.client.createTriple({
      subject,
      predicate: venturePredicate(this.ns, "missionCounter"),
      object: newCounter,
    });

    // Update updatedAt
    const existingUpdated = await this.client.listTriples({
      subject,
      predicate: venturePredicate(this.ns, "updatedAt"),
      limit: 1,
    });
    for (const t of existingUpdated.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject,
      predicate: venturePredicate(this.ns, "updatedAt"),
      object: new Date().toISOString(),
    });

    return {
      identifier: `${venture.prefix}-${newCounter}`,
      counter: newCounter,
    };
  }
}
