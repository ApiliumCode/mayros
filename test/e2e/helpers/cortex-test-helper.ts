/**
 * E2E test helpers for AIngle Cortex integration.
 *
 * Provides utilities to start a Cortex sidecar for testing,
 * skip tests gracefully when the binary is unavailable,
 * and clean up test namespaces.
 */

import { locateCortexBinary } from "../../../extensions/shared/cortex-binary-locator.js";
import { CortexClient } from "../../../extensions/shared/cortex-client.js";

export const E2E_TEST_PORT = 18_080 + Math.floor(Math.random() * 1000);
export const E2E_TEST_HOST = "127.0.0.1";
export const E2E_TEST_NS = `e2e_test_${Date.now()}`;

/**
 * Create a CortexClient for E2E tests.
 */
export function createTestClient(): CortexClient {
  return new CortexClient({
    host: E2E_TEST_HOST,
    port: E2E_TEST_PORT,
  });
}

/**
 * Check if a Cortex binary is available for E2E tests.
 * Returns the binary path or undefined.
 */
export async function findCortexBinary(): Promise<string | undefined> {
  return locateCortexBinary();
}

/**
 * Skip test suite if no Cortex binary is available.
 * Use in beforeAll: `if (skipIfNoBinary()) return;`
 */
export async function isCortexAvailable(): Promise<boolean> {
  const binary = await findCortexBinary();
  return binary !== undefined;
}

/**
 * Clean up all triples in a test namespace.
 */
export async function cleanupNamespace(client: CortexClient, namespace: string): Promise<number> {
  let cleaned = 0;
  try {
    const result = await client.patternQuery({
      subject: `${namespace}:`,
      limit: 1000,
    });
    for (const match of result.matches) {
      if (match.id) {
        try {
          await client.deleteTriple(match.id);
          cleaned++;
        } catch {
          // best-effort cleanup
        }
      }
    }
  } catch {
    // Cortex may already be stopped
  }
  return cleaned;
}

/**
 * Wait for Cortex to become healthy.
 */
export async function waitForHealth(client: CortexClient, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  let delay = 100;
  while (Date.now() - start < timeoutMs) {
    if (await client.isHealthy()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  return false;
}
