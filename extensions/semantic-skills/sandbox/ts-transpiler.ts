/**
 * TypeScript → JavaScript transpiler for skill files.
 *
 * Uses esbuild when available (fast, reliable), falls back to
 * a simple regex-based type stripping for basic skill files.
 */

/**
 * Transpile a TypeScript skill source to plain JavaScript.
 * If the file is already JS, returns the source unchanged.
 */
export async function transpileSkillToJS(source: string, filename: string): Promise<string> {
  if (/\.(js|mjs|cjs)$/.test(filename)) return source;

  try {
    // esbuild is available as a transitive dependency (via tsdown)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — esbuild is optional; may not have type declarations installed
    const esbuildModule = await import("esbuild");
    const esbuild = esbuildModule as {
      transform: (s: string, opts: Record<string, string>) => Promise<{ code: string }>;
    };
    const result = await esbuild.transform(source, {
      loader: "ts",
      format: "esm",
      target: "es2022",
    });
    return result.code;
  } catch {
    // Fallback: strip type annotations with regex for simple skill files
    return stripTypeAnnotations(source);
  }
}

/**
 * Minimal type-stripping for simple TypeScript files.
 * Handles: import type, : Type annotations, as Type, and generic <T> in type positions.
 * NOT a full parser — intended only as a fallback for simple skill code.
 */
export function stripTypeAnnotations(source: string): string {
  let result = source;

  // Remove `import type { ... } from "..."` and `import type ... from "..."`
  result = result.replace(/^\s*import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, "");
  result = result.replace(/^\s*import\s+type\s+\w+\s+from\s+['"][^'"]*['"];?\s*$/gm, "");

  // Remove `: Type` annotations after identifiers (but not in strings/comments)
  // Handles: `const x: string`, `(arg: Type)`, `): ReturnType`
  result = result.replace(
    /:\s*[A-Z]\w*(?:<[^>]*>)?(?:\s*\|\s*[A-Z]\w*(?:<[^>]*>)?)*(?=\s*[=,;)\]}])/g,
    "",
  );
  result = result.replace(
    /:\s*[a-z]\w*(?:<[^>]*>)?(?:\s*\|\s*[a-z]\w*(?:<[^>]*>)?)*(?=\s*[=,;)\]}])/g,
    "",
  );

  // Remove `as Type` casts
  result = result.replace(/\s+as\s+\w+(?:<[^>]*>)?/g, "");

  // Remove `<Type>` in angle-bracket assertions (when preceded by whitespace/opening paren)
  result = result.replace(/(?<=[(=])\s*<\w+(?:<[^>]*>)?>/g, "");

  return result;
}
