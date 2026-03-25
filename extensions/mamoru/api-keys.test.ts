import { describe, it, expect, vi, beforeEach } from "vitest";
import { MamoruApiKeys } from "./api-keys.js";
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

describe("MamoruApiKeys", () => {
  let client: ReturnType<typeof createMockClient>;
  let keys: MamoruApiKeys;

  beforeEach(() => {
    client = createMockClient();
    keys = new MamoruApiKeys(client, "test");
  });

  // 1
  it("create generates key with mk_ prefix and returns plaintext once", async () => {
    const result = await keys.create("agent-scanner", "CI Pipeline Key");
    expect(result.plaintext).toMatch(/^mk_/);
    expect(result.plaintext.length).toBeGreaterThanOrEqual(40);
    expect(result.key.prefix).toBe(result.plaintext.slice(0, 11));
    expect(result.key.agentId).toBe("agent-scanner");
    expect(result.key.name).toBe("CI Pipeline Key");
  });

  // 2
  it("create stores hash not plaintext in Cortex", async () => {
    const result = await keys.create("agent-scanner", "Test Key");
    const storedObjects = client._triples.map((t) => t.object);
    // The plaintext should NOT appear in any stored triple
    expect(storedObjects).not.toContain(result.plaintext);
    // The hash should appear
    expect(storedObjects).toContain(result.key.keyHash);
    expect(result.key.keyHash).toMatch(/^sha256:/);
  });

  // 3
  it("validate accepts correct key", async () => {
    const result = await keys.create("agent-a", "Key A");
    const validation = await keys.validate(result.plaintext);
    expect(validation.valid).toBe(true);
    expect(validation.key?.agentId).toBe("agent-a");
  });

  // 4
  it("validate rejects wrong key", async () => {
    await keys.create("agent-a", "Key A");
    const validation = await keys.validate("mk_completely_wrong_key_value_here_abcdefghij");
    expect(validation.valid).toBe(false);
    expect(validation.key).toBeUndefined();
  });

  // 5
  it("validate uses timing-safe comparison (buffers same length)", async () => {
    const result = await keys.create("agent-a", "Key A");
    // The validate method uses timingSafeEqual which requires equal-length buffers.
    // This test verifies it doesn't throw on mismatched keys.
    const validation = await keys.validate(result.plaintext);
    expect(validation.valid).toBe(true);

    const bad = await keys.validate("mk_" + "x".repeat(result.plaintext.length - 3));
    expect(bad.valid).toBe(false);
  });

  // 6
  it("revoke marks key as revoked and validate rejects it", async () => {
    const result = await keys.create("agent-a", "Key A");
    await keys.revoke(result.key.id);

    const validation = await keys.validate(result.plaintext);
    expect(validation.valid).toBe(false);
  });

  // 7
  it("list returns keys without plaintext", async () => {
    await keys.create("agent-b", "Key 1");
    await keys.create("agent-b", "Key 2");
    await keys.create("agent-c", "Key 3"); // different agent

    const agentBKeys = await keys.list("agent-b");
    expect(agentBKeys).toHaveLength(2);
    for (const key of agentBKeys) {
      expect(key.agentId).toBe("agent-b");
      // Ensure no plaintext property
      expect((key as unknown as Record<string, unknown>).plaintext).toBeUndefined();
    }
  });

  // 8
  it("rotate revokes old key and creates new with same scopes", async () => {
    const original = await keys.create("agent-a", "Key A", { scopes: ["read", "execute"] });
    const rotated = await keys.rotate(original.key.id);

    // New key has same scopes
    expect(rotated.key.scopes).toEqual(["read", "execute"]);
    // New key has different plaintext
    expect(rotated.plaintext).not.toBe(original.plaintext);
    // Old key is revoked
    const oldValidation = await keys.validate(original.plaintext);
    expect(oldValidation.valid).toBe(false);
    // New key works
    const newValidation = await keys.validate(rotated.plaintext);
    expect(newValidation.valid).toBe(true);
  });

  // 9
  it("cleanup removes expired keys", async () => {
    // Create a key that expired in the past
    const result = await keys.create("agent-a", "Expired Key", { expiresInDays: -1 });
    expect(result.key.expiresAt).toBeTruthy();

    const cleaned = await keys.cleanup();
    expect(cleaned).toBe(1);
  });

  // 10
  it("validate rejects expired keys", async () => {
    const result = await keys.create("agent-a", "Short-lived", { expiresInDays: -1 });
    const validation = await keys.validate(result.plaintext);
    expect(validation.valid).toBe(false);
  });

  // 11
  it("create respects custom scopes", async () => {
    const result = await keys.create("agent-a", "Read Only", { scopes: ["read"] });
    expect(result.key.scopes).toEqual(["read"]);
  });

  // 12
  it("rotate throws for nonexistent key", async () => {
    await expect(keys.rotate("nonexistent")).rejects.toThrow("not found");
  });

  // 13 — edge case: empty agentId still creates key (no validation on agentId)
  it("create accepts empty agentId", async () => {
    const result = await keys.create("", "Empty Agent Key");
    expect(result.key.agentId).toBe("");
    expect(result.plaintext).toMatch(/^mk_/);
  });

  // 14 — edge case: empty name still creates key
  it("create accepts empty name", async () => {
    const result = await keys.create("agent-a", "");
    expect(result.key.name).toBe("");
    expect(result.plaintext).toMatch(/^mk_/);
  });

  // 15 — rotate error message does not expose key ID
  it("rotate error message is generic", async () => {
    await expect(keys.rotate("secret-key-id-123")).rejects.toThrow("key not found");
    // Ensure the error does NOT contain the actual key ID
    try {
      await keys.rotate("secret-key-id-123");
    } catch (err) {
      expect((err as Error).message).not.toContain("secret-key-id-123");
    }
  });
});
