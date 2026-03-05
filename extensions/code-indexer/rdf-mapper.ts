/**
 * Maps code entities to RDF triples for storage in Cortex.
 *
 * Namespace convention:
 *   {ns}:code:file:{relative-path}           — file entity
 *   {ns}:code:function:{path}#{name}          — function/method
 *   {ns}:code:class:{path}#{name}             — class
 *   {ns}:code:import:{path}#{source}          — import relationship
 *
 * Predicates:
 *   {ns}:code:type        — "file" | "function" | "class" | "import"
 *   {ns}:code:path        — relative file path
 *   {ns}:code:name        — symbol name
 *   {ns}:code:line        — line number
 *   {ns}:code:exports     — link from file to exported symbol
 *   {ns}:code:imports     — link from file to import source
 *   {ns}:code:extends     — class inheritance link
 *   {ns}:code:hash        — SHA-256 of file content (for incremental)
 *   {ns}:code:indexedAt   — ISO timestamp of last index
 */

import type { CreateTripleRequest } from "../shared/cortex-client.js";
import type { CodeEntity, FileScanResult } from "./scanner.js";

// ============================================================================
// Namespace helpers
// ============================================================================

export function codePredicate(ns: string, name: string): string {
  return `${ns}:code:${name}`;
}

export function fileSubject(ns: string, filePath: string): string {
  return `${ns}:code:file:${filePath}`;
}

export function functionSubject(ns: string, filePath: string, name: string): string {
  return `${ns}:code:function:${filePath}#${name}`;
}

export function classSubject(ns: string, filePath: string, name: string): string {
  return `${ns}:code:class:${filePath}#${name}`;
}

export function importSubject(ns: string, filePath: string, source: string): string {
  return `${ns}:code:import:${filePath}#${source}`;
}

// ============================================================================
// Entity → Subject resolution
// ============================================================================

function entitySubject(ns: string, filePath: string, entity: CodeEntity): string {
  switch (entity.type) {
    case "function":
      return functionSubject(ns, filePath, entity.name);
    case "class":
      return classSubject(ns, filePath, entity.name);
    case "import":
      return importSubject(ns, filePath, entity.source ?? entity.name);
    case "export":
      return `${ns}:code:export:${filePath}#${entity.name}`;
  }
}

// ============================================================================
// File scan result → Triples
// ============================================================================

/**
 * Convert a FileScanResult (with hash/timestamp metadata) into
 * CreateTripleRequest[] for Cortex ingestion.
 */
export function fileScanToTriples(
  ns: string,
  scan: FileScanResult,
  hash: string,
): CreateTripleRequest[] {
  const triples: CreateTripleRequest[] = [];
  const fileSub = fileSubject(ns, scan.path);
  const now = new Date().toISOString();

  // File entity triples
  triples.push(
    { subject: fileSub, predicate: codePredicate(ns, "type"), object: "file" },
    { subject: fileSub, predicate: codePredicate(ns, "path"), object: scan.path },
    { subject: fileSub, predicate: codePredicate(ns, "hash"), object: hash },
    { subject: fileSub, predicate: codePredicate(ns, "indexedAt"), object: now },
  );

  for (const entity of scan.entities) {
    const sub = entitySubject(ns, scan.path, entity);

    triples.push(
      { subject: sub, predicate: codePredicate(ns, "type"), object: entity.type },
      { subject: sub, predicate: codePredicate(ns, "name"), object: entity.name },
      { subject: sub, predicate: codePredicate(ns, "path"), object: scan.path },
      { subject: sub, predicate: codePredicate(ns, "line"), object: entity.line },
    );

    // Link file → entity
    if (entity.exported) {
      triples.push({
        subject: fileSub,
        predicate: codePredicate(ns, "exports"),
        object: { node: sub },
      });
    }

    // Import relationships
    if (entity.type === "import" && entity.source) {
      triples.push({
        subject: fileSub,
        predicate: codePredicate(ns, "imports"),
        object: entity.source,
      });
    }

    // Class inheritance
    if (entity.type === "class" && entity.extends) {
      triples.push({
        subject: sub,
        predicate: codePredicate(ns, "extends"),
        object: entity.extends,
      });
    }
  }

  return triples;
}

/**
 * Extract all subjects that would be created for a given file,
 * so they can be deleted during incremental re-index.
 */
export function fileSubjects(ns: string, scan: FileScanResult): string[] {
  const subjects = [fileSubject(ns, scan.path)];
  for (const entity of scan.entities) {
    subjects.push(entitySubject(ns, scan.path, entity));
  }
  return subjects;
}
