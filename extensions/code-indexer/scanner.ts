/**
 * Regex-based code structure extraction.
 *
 * Scans TypeScript/JS files using regex patterns (no AST — consistent
 * with the `skill-scanner.ts` approach) to extract structural entities:
 * functions, classes, imports, and exports.
 */

// ============================================================================
// Types
// ============================================================================

export type CodeEntityType = "function" | "class" | "import" | "export";

export type CodeEntity = {
  type: CodeEntityType;
  name: string;
  line: number;
  exported: boolean;
  async: boolean;
  /** For classes: the parent class name if `extends` is used */
  extends?: string;
  /** For imports: the module specifier */
  source?: string;
};

export type FileScanResult = {
  path: string;
  entities: CodeEntity[];
};

// ============================================================================
// Regex Patterns
// ============================================================================

// Functions: export function name(, export async function name(
const FUNCTION_DECL = /(?:(export)\s+)?(?:(async)\s+)?function\s+(\w+)/g;

// Arrow / const functions: export const name = (, export const name = async (
const CONST_FUNCTION = /(?:(export)\s+)?const\s+(\w+)\s*=\s*(?:(async)\s+)?\(/g;

// Classes: export class Name extends Base, export abstract class Name
const CLASS_DECL = /(?:(export)\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;

// Imports: import { X } from "source", import X from "source"
const IMPORT_DECL = /import\s+(?:\{[^}]+\}|\w+|\*\s+as\s+\w+)\s+from\s+["']([^"']+)["']/g;

// Named exports: export { X, Y }
const NAMED_EXPORT = /export\s+\{([^}]+)\}/g;

// Default export: export default Name
const DEFAULT_EXPORT = /export\s+default\s+(\w+)/g;

// ============================================================================
// Scanner
// ============================================================================

/**
 * Scan a single file's source text and extract code entities.
 */
export function scanFileContent(source: string, filePath: string): FileScanResult {
  const entities: CodeEntity[] = [];
  const lines = source.split("\n");

  // Scan line-by-line for line numbers, run regex per-line for functions/classes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Function declarations
    FUNCTION_DECL.lastIndex = 0;
    let m = FUNCTION_DECL.exec(line);
    if (m) {
      entities.push({
        type: "function",
        name: m[3],
        line: lineNum,
        exported: m[1] === "export",
        async: m[2] === "async",
      });
    }

    // Const arrow functions
    CONST_FUNCTION.lastIndex = 0;
    m = CONST_FUNCTION.exec(line);
    if (m) {
      entities.push({
        type: "function",
        name: m[2],
        line: lineNum,
        exported: m[1] === "export",
        async: m[3] === "async",
      });
    }

    // Class declarations
    CLASS_DECL.lastIndex = 0;
    m = CLASS_DECL.exec(line);
    if (m) {
      entities.push({
        type: "class",
        name: m[2],
        line: lineNum,
        exported: m[1] === "export",
        async: false,
        extends: m[3] ?? undefined,
      });
    }

    // Imports
    IMPORT_DECL.lastIndex = 0;
    m = IMPORT_DECL.exec(line);
    if (m) {
      entities.push({
        type: "import",
        name: m[1],
        line: lineNum,
        exported: false,
        async: false,
        source: m[1],
      });
    }

    // Named exports
    NAMED_EXPORT.lastIndex = 0;
    m = NAMED_EXPORT.exec(line);
    if (m) {
      const names = m[1].split(",").map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      );
      for (const name of names) {
        if (name && /^\w+$/.test(name)) {
          entities.push({
            type: "export",
            name,
            line: lineNum,
            exported: true,
            async: false,
          });
        }
      }
    }

    // Default export
    DEFAULT_EXPORT.lastIndex = 0;
    m = DEFAULT_EXPORT.exec(line);
    if (m) {
      entities.push({
        type: "export",
        name: m[1],
        line: lineNum,
        exported: true,
        async: false,
      });
    }
  }

  return { path: filePath, entities };
}
