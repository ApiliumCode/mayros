/**
 * E2E: Cortex Pipeline
 *
 * Tests the TS → HTTP → Cortex → Graph pipeline end-to-end.
 * Skips gracefully if no Cortex binary is available.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import {
  findCortexBinary,
  E2E_TEST_HOST,
  E2E_TEST_NS,
  waitForHealth,
  cleanupNamespace,
} from "./helpers/cortex-test-helper.js";

let client: CortexClient;
let cortexProcess: ChildProcess | null = null;
let port: number;
let binaryPath: string | undefined;

beforeAll(async () => {
  binaryPath = await findCortexBinary();
  if (!binaryPath) {
    return;
  }

  port = 18080 + Math.floor(Math.random() * 1000);
  client = new CortexClient({ host: E2E_TEST_HOST, port });

  cortexProcess = spawn(binaryPath, ["--host", E2E_TEST_HOST, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const healthy = await waitForHealth(client);
  if (!healthy) {
    cortexProcess.kill("SIGTERM");
    cortexProcess = null;
    binaryPath = undefined;
  }
}, 30_000);

afterAll(async () => {
  if (client) {
    await cleanupNamespace(client, E2E_TEST_NS);
  }
  if (cortexProcess) {
    cortexProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

describe.skipIf(!binaryPath)("Cortex E2E Pipeline", () => {
  it("health check returns healthy", async () => {
    const health = await client.health();
    expect(health.status).toMatch(/healthy|ok/);
  });

  it("creates a triple", async () => {
    const triple = await client.createTriple({
      subject: `${E2E_TEST_NS}:test:subject1`,
      predicate: `${E2E_TEST_NS}:test:predicate1`,
      object: "test-value-1",
    });
    expect(triple.id).toBeDefined();
    expect(triple.subject).toContain("subject1");
  });

  it("lists triples", async () => {
    const result = await client.listTriples({
      subject: `${E2E_TEST_NS}:test:subject1`,
      limit: 10,
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.triples.length).toBeGreaterThanOrEqual(1);
  });

  it("pattern query finds triples", async () => {
    const result = await client.patternQuery({
      predicate: `${E2E_TEST_NS}:test:predicate1`,
      limit: 10,
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("deletes a triple", async () => {
    const created = await client.createTriple({
      subject: `${E2E_TEST_NS}:test:deleteme`,
      predicate: `${E2E_TEST_NS}:test:temp`,
      object: "to-delete",
    });
    expect(created.id).toBeDefined();

    await client.deleteTriple(created.id!);

    // Verify deletion
    const result = await client.patternQuery({
      subject: `${E2E_TEST_NS}:test:deleteme`,
      predicate: `${E2E_TEST_NS}:test:temp`,
      limit: 1,
    });
    expect(result.total).toBe(0);
  });

  it("stats endpoint returns graph statistics", async () => {
    const stats = await client.stats();
    expect(stats.graph).toBeDefined();
    expect(typeof stats.graph.triple_count).toBe("number");
  });

  it("validates triples", async () => {
    const result = await client.validate({
      triples: [
        {
          subject: `${E2E_TEST_NS}:test:s`,
          predicate: `${E2E_TEST_NS}:test:p`,
          object: "value",
        },
      ],
    });
    expect(typeof result.valid).toBe("boolean");
  });

  it("list subjects returns unique subjects", async () => {
    const result = await client.listSubjects({ limit: 100 });
    expect(Array.isArray(result.subjects)).toBe(true);
  });

  it("list predicates returns unique predicates", async () => {
    const result = await client.listPredicates({ limit: 100 });
    expect(Array.isArray(result.predicates)).toBe(true);
  });

  it("sandbox create and delete lifecycle", async () => {
    const sandbox = await client.createSandbox(`${E2E_TEST_NS}:sandbox`, 60);
    expect(sandbox.id).toBeDefined();
    expect(sandbox.namespace).toBeDefined();

    await client.deleteSandbox(sandbox.id);
  });
});
