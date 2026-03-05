/**
 * LSP Cortex Backend.
 *
 * Queries code-indexer triples and stores/retrieves LSP diagnostics
 * from AIngle Cortex.
 *
 * Diagnostic triples:
 *   Subject: ${ns}:lsp:diagnostic:${encodedFilePath}:{line}
 *   Predicates:
 *     ${ns}:lsp:severity     → error|warning|info|hint
 *     ${ns}:lsp:message      → diagnostic text
 *     ${ns}:lsp:source       → language server name
 *     ${ns}:lsp:code         → diagnostic code
 *     ${ns}:lsp:range        → JSON-encoded range
 *     ${ns}:lsp:updatedAt    → ISO timestamp
 *
 * Code-indexer predicates (read-only queries):
 *   ${ns}:code:name, ${ns}:code:path, ${ns}:code:line,
 *   ${ns}:code:type, ${ns}:code:exports
 */

import type { CortexClientLike } from "../shared/cortex-client.js";
import type { LspDiagnostic, LspRange } from "./lsp-protocol.js";
import { severityLabel, severityFromLabel } from "./lsp-protocol.js";

// ============================================================================
// Helpers
// ============================================================================

function lspPred(ns: string, field: string): string {
  return `${ns}:lsp:${field}`;
}

function codePred(ns: string, field: string): string {
  return `${ns}:code:${field}`;
}

function diagnosticSubject(ns: string, filePath: string, line: number): string {
  const encoded = encodeURIComponent(filePath);
  return `${ns}:lsp:diagnostic:${encoded}:${line}`;
}

function diagnosticPrefix(ns: string, filePath: string): string {
  const encoded = encodeURIComponent(filePath);
  return `${ns}:lsp:diagnostic:${encoded}:`;
}

// ============================================================================
// Types
// ============================================================================

export type DefinitionResult = {
  name: string;
  path: string;
  line: number;
  type: string;
} | null;

export type SymbolInfo = {
  name: string;
  type: string;
  path: string;
  line: number;
  exported?: boolean;
} | null;

// ============================================================================
// LspCortexBackend
// ============================================================================

export class LspCortexBackend {
  constructor(
    private readonly cortex: CortexClientLike,
    private readonly ns: string,
  ) {}

  // ---------- Diagnostics ----------

  /**
   * Store diagnostics for a file in Cortex.
   * Clears existing diagnostics for the file first.
   */
  async storeDiagnostics(uri: string, diagnostics: LspDiagnostic[], source: string): Promise<void> {
    const filePath = uri.replace(/^file:\/\//, "");

    // Clear existing diagnostics for this file
    await this.clearDiagnostics(uri);

    const now = new Date().toISOString();

    for (const diag of diagnostics) {
      const subject = diagnosticSubject(this.ns, filePath, diag.range.start.line);

      const fields: Array<[string, string]> = [
        ["severity", severityLabel(diag.severity)],
        ["message", diag.message],
        ["source", source],
        ["range", JSON.stringify(diag.range)],
        ["updatedAt", now],
      ];

      if (diag.code !== undefined) {
        fields.push(["code", String(diag.code)]);
      }

      for (const [field, value] of fields) {
        await this.cortex.createTriple({
          subject,
          predicate: lspPred(this.ns, field),
          object: value,
        });
      }
    }
  }

  /**
   * Get diagnostics from Cortex, optionally filtered by file.
   */
  async getDiagnostics(uri?: string): Promise<
    Array<{
      uri: string;
      diagnostic: LspDiagnostic;
      source: string;
    }>
  > {
    const results: Array<{
      uri: string;
      diagnostic: LspDiagnostic;
      source: string;
    }> = [];

    // Query by message predicate (all diagnostics have a message)
    const matches = await this.cortex.patternQuery({
      predicate: lspPred(this.ns, "message"),
      limit: 200,
    });

    const prefix = `${this.ns}:lsp:diagnostic:`;

    for (const match of matches.matches) {
      const sub = String(match.subject);
      if (!sub.startsWith(prefix)) continue;

      // Extract file path and line from subject
      const rest = sub.slice(prefix.length);
      const lastColon = rest.lastIndexOf(":");
      if (lastColon < 0) continue;

      const encodedPath = rest.slice(0, lastColon);
      const filePath = decodeURIComponent(encodedPath);
      const fileUri = filePath.startsWith("/") ? `file://${filePath}` : filePath;

      // Filter by uri if specified
      if (uri && fileUri !== uri && filePath !== uri.replace(/^file:\/\//, "")) {
        continue;
      }

      const fields = await this.getFields(sub, ["severity", "message", "source", "code", "range"]);

      let range: LspRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      if (fields.range) {
        try {
          range = JSON.parse(fields.range) as LspRange;
        } catch {
          // Use default range
        }
      }

      results.push({
        uri: fileUri,
        source: fields.source ?? "unknown",
        diagnostic: {
          range,
          severity: severityFromLabel(fields.severity ?? "unknown"),
          code: fields.code,
          message: fields.message ?? String(match.object),
        },
      });
    }

    return results;
  }

  /**
   * Clear all diagnostics for a file.
   */
  async clearDiagnostics(uri: string): Promise<void> {
    const filePath = uri.replace(/^file:\/\//, "");
    const prefix = diagnosticPrefix(this.ns, filePath);

    // Find all diagnostics for this file by querying the message predicate
    const matches = await this.cortex.patternQuery({
      predicate: lspPred(this.ns, "message"),
      limit: 200,
    });

    for (const match of matches.matches) {
      const sub = String(match.subject);
      if (!sub.startsWith(prefix)) continue;

      // Delete all triples for this subject
      for (const field of ["severity", "message", "source", "code", "range", "updatedAt"]) {
        const triples = await this.cortex.listTriples({
          subject: sub,
          predicate: lspPred(this.ns, field),
          limit: 10,
        });
        for (const t of triples.triples) {
          if (t.id) await this.cortex.deleteTriple(t.id);
        }
      }
    }
  }

  // ---------- Code-indexer queries ----------

  /**
   * Lookup a symbol definition from code-indexer triples.
   */
  async lookupDefinition(name: string): Promise<DefinitionResult> {
    // Query code-indexer triples by name
    const matches = await this.cortex.patternQuery({
      predicate: codePred(this.ns, "name"),
      object: name,
      limit: 10,
    });

    if (matches.matches.length === 0) return null;

    // Get the first match's details
    const subject = String(matches.matches[0].subject);
    const fields = await this.getCodeFields(subject, ["path", "line", "type"]);

    if (!fields.path) return null;

    return {
      name,
      path: fields.path,
      line: Number.parseInt(fields.line ?? "0", 10),
      type: fields.type ?? "unknown",
    };
  }

  /**
   * Lookup symbol info for hover.
   */
  async lookupSymbol(name: string): Promise<SymbolInfo> {
    const matches = await this.cortex.patternQuery({
      predicate: codePred(this.ns, "name"),
      object: name,
      limit: 10,
    });

    if (matches.matches.length === 0) return null;

    const subject = String(matches.matches[0].subject);
    const fields = await this.getCodeFields(subject, ["path", "line", "type"]);

    if (!fields.path) return null;

    // Check if exported
    const fileSubject = `${this.ns}:code:file:${fields.path}`;
    const exports = await this.cortex.patternQuery({
      subject: fileSubject,
      predicate: codePred(this.ns, "exports"),
      object: { node: subject },
      limit: 1,
    });

    return {
      name,
      type: fields.type ?? "unknown",
      path: fields.path,
      line: Number.parseInt(fields.line ?? "0", 10),
      exported: exports.matches.length > 0,
    };
  }

  // ---------- Internal helpers ----------

  private async getFields(subject: string, fields: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const field of fields) {
      const triples = await this.cortex.listTriples({
        subject,
        predicate: lspPred(this.ns, field),
        limit: 1,
      });
      if (triples.triples.length > 0) {
        const val = triples.triples[0].object;
        result[field] =
          typeof val === "object" && val !== null && "node" in val
            ? String((val as { node: string }).node)
            : String(val);
      }
    }
    return result;
  }

  private async getCodeFields(subject: string, fields: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const field of fields) {
      const triples = await this.cortex.listTriples({
        subject,
        predicate: codePred(this.ns, field),
        limit: 1,
      });
      if (triples.triples.length > 0) {
        const val = triples.triples[0].object;
        result[field] =
          typeof val === "object" && val !== null && "node" in val
            ? String((val as { node: string }).node)
            : String(val);
      }
    }
    return result;
  }
}
