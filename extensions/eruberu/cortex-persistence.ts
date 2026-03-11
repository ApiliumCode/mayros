/**
 * Cortex Persistence for Eruberu Q-Table
 *
 * Stores Q-table values as RDF triples in Cortex when available,
 * with fallback to local JSON file.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { QTableData } from "./q-learning.js";

// ============================================================================
// Cortex persistence (primary)
// ============================================================================

export type CortexPersistenceClient = {
  createTriple(params: { subject: string; predicate: string; object: string }): Promise<unknown>;
  listTriples(params: {
    subject?: string;
    predicate?: string;
    limit?: number;
  }): Promise<{
    triples: Array<{ id?: string; subject: string; predicate: string; object: unknown }>;
  }>;
  deleteTriple(id: string): Promise<void>;
};

const SUBJECT = "eruberu:qtable";
const PREDICATE_PREFIX = "eruberu:qvalue:";

/**
 * Save Q-table to Cortex as triples.
 * Each state:action pair is stored as a separate triple.
 */
export async function saveToCortex(
  client: CortexPersistenceClient,
  data: QTableData,
): Promise<void> {
  // Delete existing entries
  const existing = await client.listTriples({ subject: SUBJECT, limit: 10000 });
  for (const triple of existing.triples) {
    if (triple.id) {
      await client.deleteTriple(triple.id);
    }
  }

  // Write new entries
  for (const [state, actions] of Object.entries(data)) {
    for (const [action, value] of Object.entries(actions)) {
      await client.createTriple({
        subject: SUBJECT,
        predicate: `${PREDICATE_PREFIX}${state}:${action}`,
        object: String(value),
      });
    }
  }
}

/**
 * Load Q-table from Cortex triples.
 */
export async function loadFromCortex(client: CortexPersistenceClient): Promise<QTableData> {
  const result = await client.listTriples({ subject: SUBJECT, limit: 10000 });
  const data: QTableData = {};

  for (const triple of result.triples) {
    const pred = String(triple.predicate);
    if (!pred.startsWith(PREDICATE_PREFIX)) continue;

    const rest = pred.slice(PREDICATE_PREFIX.length);
    // Parse "taskType:budgetLevel:timeSlot:strategy:provider?" pattern
    // State is first 3 segments, action is the remainder
    const segments = rest.split(":");
    if (segments.length < 4) continue;

    const stateKey = segments.slice(0, 3).join(":");
    const actionKey = segments.slice(3).join(":");

    const value =
      typeof triple.object === "object" && triple.object !== null && "node" in triple.object
        ? Number((triple.object as { node: string }).node)
        : Number(triple.object);

    if (isNaN(value)) continue;

    if (!data[stateKey]) data[stateKey] = {};
    data[stateKey]![actionKey] = value;
  }

  return data;
}

// ============================================================================
// File persistence (fallback)
// ============================================================================

function resolvePath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

/**
 * Save Q-table to a JSON file.
 */
export async function saveToFile(path: string, data: QTableData): Promise<void> {
  const resolved = resolvePath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Load Q-table from a JSON file. Returns empty data if file doesn't exist.
 */
export async function loadFromFile(path: string): Promise<QTableData> {
  const resolved = resolvePath(path);
  try {
    const content = await readFile(resolved, "utf-8");
    return JSON.parse(content) as QTableData;
  } catch {
    return {};
  }
}
