/**
 * Code Indexer Tests
 *
 * Tests cover:
 * - Scanner: regex extraction of functions, classes, imports, exports
 * - RDF Mapper: entity → triple conversion, namespace correctness
 * - Incremental: hash computation, file change detection
 * - Config: parsing and validation
 */

import { describe, test, expect } from "vitest";
import { scanFileContent, type CodeEntity } from "./scanner.js";
import {
  codePredicate,
  fileSubject,
  functionSubject,
  classSubject,
  importSubject,
  fileScanToTriples,
  fileSubjects,
} from "./rdf-mapper.js";
import { computeHash } from "./incremental.js";

// ============================================================================
// Scanner Tests
// ============================================================================

describe("scanner", () => {
  test("extracts function declarations", () => {
    const source = `
function helper() {}
export function doStuff() {}
export async function fetchData() {}
async function internalAsync() {}
`;
    const result = scanFileContent(source, "src/utils.ts");

    const functions = result.entities.filter((e) => e.type === "function");
    expect(functions).toHaveLength(4);

    expect(functions[0]).toMatchObject({ name: "helper", exported: false, async: false });
    expect(functions[1]).toMatchObject({ name: "doStuff", exported: true, async: false });
    expect(functions[2]).toMatchObject({ name: "fetchData", exported: true, async: true });
    expect(functions[3]).toMatchObject({ name: "internalAsync", exported: false, async: true });
  });

  test("extracts const arrow functions", () => {
    const source = `
const add = (a: number, b: number) => a + b;
export const multiply = (a: number, b: number) => a * b;
export const fetchUser = async (id: string) => {};
`;
    const result = scanFileContent(source, "src/math.ts");

    const functions = result.entities.filter((e) => e.type === "function");
    expect(functions).toHaveLength(3);

    expect(functions[0]).toMatchObject({ name: "add", exported: false, async: false });
    expect(functions[1]).toMatchObject({ name: "multiply", exported: true, async: false });
    expect(functions[2]).toMatchObject({ name: "fetchUser", exported: true, async: true });
  });

  test("extracts class declarations", () => {
    const source = `
class InternalClass {}
export class MyService extends BaseService {}
export abstract class AbstractHandler {}
`;
    const result = scanFileContent(source, "src/service.ts");

    const classes = result.entities.filter((e) => e.type === "class");
    expect(classes).toHaveLength(3);

    expect(classes[0]).toMatchObject({
      name: "InternalClass",
      exported: false,
      extends: undefined,
    });
    expect(classes[1]).toMatchObject({ name: "MyService", exported: true, extends: "BaseService" });
    expect(classes[2]).toMatchObject({
      name: "AbstractHandler",
      exported: true,
      extends: undefined,
    });
  });

  test("extracts imports", () => {
    const source = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
`;
    const result = scanFileContent(source, "src/index.ts");

    const imports = result.entities.filter((e) => e.type === "import");
    expect(imports).toHaveLength(4);

    expect(imports[0]).toMatchObject({ source: "node:fs/promises" });
    expect(imports[1]).toMatchObject({ source: "node:path" });
    expect(imports[2]).toMatchObject({ source: "node:crypto" });
    expect(imports[3]).toMatchObject({ source: "@sinclair/typebox" });
  });

  test("extracts named exports", () => {
    const source = `
export { foo, bar as baz }
export default myPlugin
`;
    const result = scanFileContent(source, "src/plugin.ts");

    const exports = result.entities.filter((e) => e.type === "export");
    expect(exports).toHaveLength(3);

    expect(exports[0]).toMatchObject({ name: "foo", exported: true });
    expect(exports[1]).toMatchObject({ name: "bar", exported: true });
    expect(exports[2]).toMatchObject({ name: "myPlugin", exported: true });
  });

  test("records correct line numbers", () => {
    const source = `import { X } from "x";

function first() {}

export class Second {}
`;
    const result = scanFileContent(source, "src/lines.ts");

    const importEntity = result.entities.find((e) => e.type === "import");
    expect(importEntity?.line).toBe(1);

    const funcEntity = result.entities.find((e) => e.type === "function");
    expect(funcEntity?.line).toBe(3);

    const classEntity = result.entities.find((e) => e.type === "class");
    expect(classEntity?.line).toBe(5);
  });

  test("handles empty file", () => {
    const result = scanFileContent("", "empty.ts");
    expect(result.entities).toHaveLength(0);
    expect(result.path).toBe("empty.ts");
  });

  test("handles file with only comments", () => {
    const source = `
// This is a comment
/* Block comment */
/** JSDoc */
`;
    const result = scanFileContent(source, "comments.ts");
    expect(result.entities).toHaveLength(0);
  });
});

// ============================================================================
// RDF Mapper Tests
// ============================================================================

describe("rdf-mapper", () => {
  const ns = "test";

  test("codePredicate formats correctly", () => {
    expect(codePredicate(ns, "type")).toBe("test:code:type");
    expect(codePredicate(ns, "path")).toBe("test:code:path");
    expect(codePredicate(ns, "hash")).toBe("test:code:hash");
  });

  test("fileSubject formats correctly", () => {
    expect(fileSubject(ns, "src/index.ts")).toBe("test:code:file:src/index.ts");
  });

  test("functionSubject formats correctly", () => {
    expect(functionSubject(ns, "src/utils.ts", "helper")).toBe(
      "test:code:function:src/utils.ts#helper",
    );
  });

  test("classSubject formats correctly", () => {
    expect(classSubject(ns, "src/service.ts", "MyService")).toBe(
      "test:code:class:src/service.ts#MyService",
    );
  });

  test("importSubject formats correctly", () => {
    expect(importSubject(ns, "src/index.ts", "node:path")).toBe(
      "test:code:import:src/index.ts#node:path",
    );
  });

  test("fileScanToTriples generates correct triples for file", () => {
    const scan = scanFileContent(`export function greet() {}`, "src/hello.ts");

    const triples = fileScanToTriples(ns, scan, "abc123");

    // File triples: type, path, hash, indexedAt
    const fileTriples = triples.filter((t) => t.subject === "test:code:file:src/hello.ts");
    expect(fileTriples.length).toBeGreaterThanOrEqual(4);

    const typeTriple = fileTriples.find((t) => t.predicate === "test:code:type");
    expect(typeTriple?.object).toBe("file");

    const hashTriple = fileTriples.find((t) => t.predicate === "test:code:hash");
    expect(hashTriple?.object).toBe("abc123");
  });

  test("fileScanToTriples generates export links", () => {
    const scan = scanFileContent(`export function greet() {}`, "src/hello.ts");

    const triples = fileScanToTriples(ns, scan, "hash");

    const exportLink = triples.find((t) => t.predicate === "test:code:exports");
    expect(exportLink).toBeDefined();
    expect(exportLink?.subject).toBe("test:code:file:src/hello.ts");
    expect(exportLink?.object).toEqual({
      node: "test:code:function:src/hello.ts#greet",
    });
  });

  test("fileScanToTriples generates import relationships", () => {
    const scan = scanFileContent(`import { readFile } from "node:fs/promises";`, "src/io.ts");

    const triples = fileScanToTriples(ns, scan, "hash");

    const importTriple = triples.find((t) => t.predicate === "test:code:imports");
    expect(importTriple).toBeDefined();
    expect(importTriple?.object).toBe("node:fs/promises");
  });

  test("fileScanToTriples generates class extends link", () => {
    const scan = scanFileContent(`export class MyService extends BaseService {}`, "src/service.ts");

    const triples = fileScanToTriples(ns, scan, "hash");

    const extendsTriple = triples.find((t) => t.predicate === "test:code:extends");
    expect(extendsTriple).toBeDefined();
    expect(extendsTriple?.object).toBe("BaseService");
  });

  test("fileSubjects returns all subjects for a scan", () => {
    const scan = scanFileContent(`export function a() {}\nexport class B {}`, "src/mixed.ts");

    const subjects = fileSubjects(ns, scan);
    expect(subjects).toContain("test:code:file:src/mixed.ts");
    expect(subjects).toContain("test:code:function:src/mixed.ts#a");
    expect(subjects).toContain("test:code:class:src/mixed.ts#B");
  });
});

// ============================================================================
// Incremental Tests
// ============================================================================

describe("incremental", () => {
  test("computeHash produces consistent SHA-256", () => {
    const hash1 = computeHash("hello world");
    const hash2 = computeHash("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  test("computeHash detects content changes", () => {
    const hash1 = computeHash("version 1");
    const hash2 = computeHash("version 2");
    expect(hash1).not.toBe(hash2);
  });

  test("computeHash handles empty content", () => {
    const hash = computeHash("");
    expect(hash).toHaveLength(64);
  });
});

// ============================================================================
// Config Tests
// ============================================================================

describe("code-indexer config", () => {
  test("parses valid config with defaults", async () => {
    const { default: plugin } = await import("./index.js");

    const config = plugin.configSchema?.parse?.({});

    expect(config).toBeDefined();
    expect(config?.cortex?.host).toBe("127.0.0.1");
    expect(config?.cortex?.port).toBe(19090);
    expect(config?.agentNamespace).toBe("mayros");
    expect(config?.paths).toEqual(["src", "extensions"]);
    expect(config?.maxFiles).toBe(5000);
  });

  test("parses custom paths and limits", async () => {
    const { default: plugin } = await import("./index.js");

    const config = plugin.configSchema?.parse?.({
      paths: ["lib", "packages"],
      maxFiles: 1000,
      extensions: [".ts"],
    });

    expect(config?.paths).toEqual(["lib", "packages"]);
    expect(config?.maxFiles).toBe(1000);
    expect(config?.extensions).toEqual([".ts"]);
  });

  test("rejects invalid namespace", async () => {
    const { default: plugin } = await import("./index.js");

    expect(() => {
      plugin.configSchema?.parse?.({
        agentNamespace: "123-bad",
      });
    }).toThrow("agentNamespace must start with a letter");
  });

  test("clamps maxFiles to safe range", async () => {
    const { default: plugin } = await import("./index.js");

    const config = plugin.configSchema?.parse?.({
      maxFiles: -1,
    });

    // Falls back to default when out of range
    expect(config?.maxFiles).toBe(5000);
  });
});

// ============================================================================
// Plugin Metadata Tests
// ============================================================================

describe("code-indexer plugin", () => {
  test("has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("code-indexer");
    expect(plugin.name).toBe("Code Indexer");
    expect(plugin.kind).toBe("indexer");
    expect(plugin.configSchema).toBeDefined();
    expect(typeof plugin.register).toBe("function");
  });
});
