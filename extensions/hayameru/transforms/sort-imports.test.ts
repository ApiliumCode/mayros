import { describe, it, expect } from "vitest";
import { sortImports } from "./sort-imports.js";

describe("sortImports", () => {
  it("sorts imports alphabetically", () => {
    const source = [
      'import { z } from "zod";',
      'import { a } from "alpha";',
      "",
      "const x = 1;",
    ].join("\n");
    const r = sortImports(source, "test.ts");
    expect(r.changed).toBe(true);
    const lines = r.output.split("\n");
    expect(lines[0]).toContain("alpha");
  });

  it("groups by type: node, scoped, bare, relative", () => {
    const source = [
      'import { readFile } from "node:fs";',
      'import { join } from "./utils.js";',
      'import { Type } from "@sinclair/typebox";',
      'import express from "express";',
    ].join("\n");
    const r = sortImports(source, "test.ts");
    expect(r.changed).toBe(true);
    const lines = r.output.split("\n").filter(Boolean);
    // node: first, then @scope, then bare, then relative
    expect(lines[0]).toContain("node:fs");
    expect(lines[lines.length - 1]).toContain("./utils");
  });

  it("leaves already sorted imports unchanged", () => {
    const source = 'import { a } from "a";\nimport { b } from "b";';
    const r = sortImports(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  // --- H5 fixes ---

  it("keeps side-effect imports in place", () => {
    const source = [
      'import "polyfill";',
      'import { z } from "zod";',
      'import { a } from "alpha";',
      "",
      "const x = 1;",
    ].join("\n");
    const r = sortImports(source, "test.ts");
    const lines = r.output.split("\n").filter(Boolean);
    // Side-effect import should be first (before sorted imports)
    expect(lines[0]).toBe('import "polyfill";');
    // Sorted imports follow
    expect(lines[1]).toContain("alpha");
    expect(lines[2]).toContain("zod");
  });

  it("handles side-effect imports with single quotes", () => {
    const source = [
      "import './setup';",
      'import { b } from "beta";',
      'import { a } from "alpha";',
      "",
      "const x = 1;",
    ].join("\n");
    const r = sortImports(source, "test.ts");
    const lines = r.output.split("\n").filter(Boolean);
    expect(lines[0]).toBe("import './setup';");
  });

  it("handles multi-line imports", () => {
    const source = [
      "import {",
      "  readFile,",
      "  writeFile,",
      '} from "node:fs";',
      'import { a } from "alpha";',
      "",
      "const x = 1;",
    ].join("\n");
    const r = sortImports(source, "test.ts");
    // Multi-line import should be parsed and included in sorting
    const outputLines = r.output.split("\n");
    // alpha (bare, group 2) should come after node:fs (group 0)
    const fsIdx = outputLines.findIndex((l: string) => l.includes("node:fs"));
    const alphaIdx = outputLines.findIndex((l: string) => l.includes("alpha"));
    expect(fsIdx).toBeLessThan(alphaIdx);
  });

  it("handles mix of side-effect, single-line, and multi-line imports", () => {
    const source = [
      'import "reflect-metadata";',
      'import { z } from "zod";',
      "import {",
      "  Component,",
      "  OnInit,",
      '} from "@angular/core";',
      'import { a } from "alpha";',
      "",
      "const x = 1;",
    ].join("\n");
    const r = sortImports(source, "test.ts");
    const outputLines = r.output.split("\n");
    // Side-effect import first
    expect(outputLines[0]).toBe('import "reflect-metadata";');
    // Then sorted: @angular/core (group 1), alpha (group 2), zod (group 2)
    const angularIdx = outputLines.findIndex((l: string) => l.includes("@angular/core"));
    const alphaIdx = outputLines.findIndex((l: string) => l.includes("alpha"));
    const zodIdx = outputLines.findIndex((l: string) => l.includes("zod"));
    expect(angularIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(zodIdx);
  });
});
