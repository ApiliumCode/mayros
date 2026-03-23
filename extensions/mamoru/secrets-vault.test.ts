import { describe, it, expect, vi, beforeEach } from "vitest";
import { MamoruVault } from "./secrets-vault.js";
import type { CortexClientLike } from "../shared/cortex-client.js";

// ── Mock Cortex client ───────────────────────────────────────────────

function createMockClient(): CortexClientLike & {
  _triples: Array<{ id: string; subject: string; predicate: string; object: string }>;
} {
  const triples: Array<{ id: string; subject: string; predicate: string; object: string }> = [];
  let nextId = 1;

  return {
    _triples: triples,

    createTriple: vi.fn(async (req) => {
      const id = `t-${nextId++}`;
      const triple = { id, subject: req.subject, predicate: req.predicate, object: String(req.object) };
      triples.push(triple);
      return triple;
    }),

    listTriples: vi.fn(async (query) => {
      let filtered = [...triples];
      if (query?.subject) filtered = filtered.filter((t) => t.subject === query.subject);
      if (query?.predicate) filtered = filtered.filter((t) => t.predicate === query.predicate);
      return { triples: filtered, total: filtered.length };
    }),

    patternQuery: vi.fn(async () => ({ matches: [], total: 0 })),

    deleteTriple: vi.fn(async (id) => {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    }),
  };
}

describe("MamoruVault", () => {
  let client: ReturnType<typeof createMockClient>;
  let vault: MamoruVault;
  const PASSWORD = "test-master-password-2026";

  beforeEach(() => {
    client = createMockClient();
    vault = new MamoruVault(client, "test", PASSWORD);
  });

  // 1
  it("store encrypts value (stored value != plaintext)", async () => {
    const secret = await vault.store("ANTHROPIC_API_KEY", "sk-ant-secret-value");

    // The encrypted value should not equal the plaintext
    expect(secret.encryptedValue).not.toBe("sk-ant-secret-value");
    expect(secret.iv).toBeTruthy();
    expect(secret.tag).toBeTruthy();

    // Verify no triple contains the plaintext
    const storedObjects = client._triples.map((t) => t.object);
    expect(storedObjects).not.toContain("sk-ant-secret-value");
  });

  // 2
  it("retrieve decrypts correctly with right password", async () => {
    await vault.store("MY_SECRET", "super-secret-value-123");
    const retrieved = await vault.retrieve("MY_SECRET");
    expect(retrieved).toBe("super-secret-value-123");
  });

  // 3
  it("retrieve returns null for wrong password", async () => {
    await vault.store("MY_SECRET", "super-secret-value-123");

    // Create a new vault with different password against same store
    const wrongVault = new MamoruVault(client, "test", "wrong-password");
    const retrieved = await wrongVault.retrieve("MY_SECRET");
    expect(retrieved).toBeNull();
  });

  // 4
  it("retrieve returns null for missing secret", async () => {
    const retrieved = await vault.retrieve("NONEXISTENT");
    expect(retrieved).toBeNull();
  });

  // 5
  it("rotate increments version", async () => {
    const v1 = await vault.store("ROTATE_ME", "value-v1");
    expect(v1.version).toBe(1);

    const v2 = await vault.rotate("ROTATE_ME", "value-v2");
    expect(v2.version).toBe(2);

    // Retrieving should give latest value
    const retrieved = await vault.retrieve("ROTATE_ME");
    expect(retrieved).toBe("value-v2");
  });

  // 6
  it("list returns metadata without values", async () => {
    await vault.store("SECRET_A", "value-a");
    await vault.store("SECRET_B", "value-b", { scope: "agent", scopeId: "agent-1" });

    const items = await vault.list();
    expect(items).toHaveLength(2);

    const names = items.map((i) => i.name);
    expect(names).toContain("SECRET_A");
    expect(names).toContain("SECRET_B");

    // Ensure no values are exposed
    for (const item of items) {
      expect((item as unknown as Record<string, unknown>).value).toBeUndefined();
      expect((item as unknown as Record<string, unknown>).encryptedValue).toBeUndefined();
    }
  });

  // 7
  it("delete removes secret", async () => {
    await vault.store("TO_DELETE", "delete-me");
    expect(await vault.exists("TO_DELETE")).toBe(true);

    await vault.delete("TO_DELETE");
    expect(await vault.exists("TO_DELETE")).toBe(false);
  });

  // 8
  it("exists checks presence", async () => {
    expect(await vault.exists("NOPE")).toBe(false);

    await vault.store("YES", "present");
    expect(await vault.exists("YES")).toBe(true);
  });

  // 9
  it("exportEnv returns decrypted map", async () => {
    await vault.store("DB_HOST", "localhost");
    await vault.store("DB_PORT", "5432");
    await vault.store("DB_PASS", "secret");

    const env = await vault.exportEnv(["DB_HOST", "DB_PORT"]);
    expect(env).toEqual({
      DB_HOST: "localhost",
      DB_PORT: "5432",
    });
  });

  // 10
  it("AES-256-GCM tag verification rejects tampered data", async () => {
    await vault.store("TAMPER_TEST", "original-value");

    // Find and tamper with the encrypted data in the store
    const encTriple = client._triples.find((t) => t.predicate.includes("secret:encrypted"));
    expect(encTriple).toBeTruthy();

    // Corrupt the encrypted data
    const original = encTriple!.object;
    encTriple!.object = Buffer.from("tampered-data-here").toString("base64");

    // Retrieval should fail (return null) due to GCM auth tag mismatch
    const retrieved = await vault.retrieve("TAMPER_TEST");
    expect(retrieved).toBeNull();

    // Restore for cleanup
    encTriple!.object = original;
  });
});
