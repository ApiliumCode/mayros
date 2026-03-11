import type { IntentKind } from "../intent-detector.js";
import type { TransformResult } from "./var-to-const.js";
import { varToConst } from "./var-to-const.js";
import { removeConsole } from "./remove-console.js";
import { sortImports } from "./sort-imports.js";
import { addSemicolons } from "./add-semicolons.js";
import { removeComments } from "./remove-comments.js";

export type { TransformResult };

export type TransformFn = (source: string, filePath: string) => TransformResult;

const REGISTRY: Partial<Record<IntentKind, TransformFn>> = {
  "var-to-const": varToConst,
  "remove-console": removeConsole,
  "sort-imports": sortImports,
  "add-semicolons": addSemicolons,
  "remove-comments": removeComments,
};

export function getTransform(kind: IntentKind): TransformFn | undefined {
  return REGISTRY[kind];
}

export function listTransforms(): Array<{ kind: IntentKind; available: boolean }> {
  const all: IntentKind[] = [
    "var-to-const",
    "remove-console",
    "sort-imports",
    "add-semicolons",
    "remove-comments",
  ];
  return all.map((kind) => ({ kind, available: kind in REGISTRY }));
}
