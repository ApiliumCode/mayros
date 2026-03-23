/**
 * Mamoru API Keys — Agent API key management
 *
 * Generate, hash, validate, revoke, and rotate API keys for agents.
 * Keys are stored as Cortex triples with SHA-256 hashes — plaintext
 * is returned exactly once at creation time.
 *
 * Key format: mk_ + 32 bytes base64url (48 chars total)
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { CortexClientLike } from "../shared/cortex-client.js";

// ── Types ────────────────────────────────────────────────────────────────

export type ApiKey = {
  id: string;
  name: string;
  agentId: string;
  keyHash: string;       // SHA-256 hash of the key (never store plaintext)
  prefix: string;        // first 8 chars for identification (e.g., "mk_a1b2c3d4")
  scopes: string[];      // e.g., ["read", "write", "execute"]
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
};

export type ApiKeyCreateResult = {
  key: ApiKey;
  plaintext: string;     // shown ONCE at creation, never stored
};

// ── Helpers ──────────────────────────────────────────────────────────────

function generateKeyId(): string {
  return randomBytes(8).toString("hex");
}

function generatePlaintext(): string {
  return "mk_" + randomBytes(32).toString("base64url");
}

function hashKey(plaintext: string): string {
  return "sha256:" + createHash("sha256").update(plaintext).digest("hex");
}

function extractPrefix(plaintext: string): string {
  return plaintext.slice(0, 11); // "mk_" + 8 chars
}

// ── Predicate constants ─────────────────────────────────────────────────

const PRED = {
  keyHash: "apikey:keyHash",
  prefix: "apikey:prefix",
  agentId: "apikey:agentId",
  name: "apikey:name",
  scopes: "apikey:scopes",
  createdAt: "apikey:createdAt",
  lastUsedAt: "apikey:lastUsedAt",
  revokedAt: "apikey:revokedAt",
  expiresAt: "apikey:expiresAt",
} as const;

// ── Implementation ───────────────────────────────────────────────────────

export class MamoruApiKeys {
  private readonly ns: string;
  private readonly client: CortexClientLike;

  constructor(client: CortexClientLike, ns: string) {
    this.client = client;
    this.ns = ns;
  }

  private subject(keyId: string): string {
    return `${this.ns}:apikey:${keyId}`;
  }

  private predicate(pred: string): string {
    return `${this.ns}:${pred}`;
  }

  /**
   * Create a new API key for an agent.
   * Returns the plaintext key ONCE — it is never stored.
   */
  async create(
    agentId: string,
    name: string,
    opts?: { scopes?: string[]; expiresInDays?: number },
  ): Promise<ApiKeyCreateResult> {
    const id = generateKeyId();
    const plaintext = generatePlaintext();
    const hash = hashKey(plaintext);
    const prefix = extractPrefix(plaintext);
    const scopes = opts?.scopes ?? ["read", "write"];
    const now = new Date().toISOString();
    const expiresAt = opts?.expiresInDays
      ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString()
      : null;

    const sub = this.subject(id);

    const triples: Array<{ subject: string; predicate: string; object: string }> = [
      { subject: sub, predicate: this.predicate(PRED.keyHash), object: hash },
      { subject: sub, predicate: this.predicate(PRED.prefix), object: prefix },
      { subject: sub, predicate: this.predicate(PRED.agentId), object: agentId },
      { subject: sub, predicate: this.predicate(PRED.name), object: name },
      { subject: sub, predicate: this.predicate(PRED.scopes), object: scopes.join(",") },
      { subject: sub, predicate: this.predicate(PRED.createdAt), object: now },
    ];

    if (expiresAt) {
      triples.push({
        subject: sub,
        predicate: this.predicate(PRED.expiresAt),
        object: expiresAt,
      });
    }

    for (const triple of triples) {
      await this.client.createTriple(triple);
    }

    const key: ApiKey = {
      id,
      name,
      agentId,
      keyHash: hash,
      prefix,
      scopes,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      expiresAt,
    };

    return { key, plaintext };
  }

  /**
   * Validate a plaintext key.
   * Uses timing-safe comparison to prevent timing attacks.
   * Updates lastUsedAt on success.
   */
  async validate(plaintext: string): Promise<{ valid: boolean; key?: ApiKey }> {
    const inputHash = hashKey(plaintext);
    const inputHashBuf = Buffer.from(inputHash);

    // Find all keys by scanning for keyHash predicates
    const result = await this.client.listTriples({
      predicate: this.predicate(PRED.keyHash),
      limit: 10_000,
    });

    for (const triple of result.triples) {
      const storedHash = String(triple.object);
      const storedHashBuf = Buffer.from(storedHash);

      // Timing-safe comparison — buffers must be same length
      if (inputHashBuf.length !== storedHashBuf.length) continue;
      if (!timingSafeEqual(inputHashBuf, storedHashBuf)) continue;

      // Found a match — load the full key
      const subject = triple.subject;
      const key = await this.loadKey(subject);
      if (!key) continue;

      // Check revocation
      if (key.revokedAt) return { valid: false };

      // Check expiry
      if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
        return { valid: false };
      }

      // Update lastUsedAt
      await this.client.createTriple({
        subject,
        predicate: this.predicate(PRED.lastUsedAt),
        object: new Date().toISOString(),
      });

      return { valid: true, key };
    }

    return { valid: false };
  }

  /**
   * Revoke an API key by ID.
   */
  async revoke(keyId: string): Promise<void> {
    const sub = this.subject(keyId);
    await this.client.createTriple({
      subject: sub,
      predicate: this.predicate(PRED.revokedAt),
      object: new Date().toISOString(),
    });
  }

  /**
   * List all API keys for an agent (never returns plaintext).
   */
  async list(agentId: string): Promise<ApiKey[]> {
    const result = await this.client.listTriples({
      predicate: this.predicate(PRED.agentId),
      limit: 10_000,
    });

    const keys: ApiKey[] = [];
    for (const triple of result.triples) {
      if (String(triple.object) !== agentId) continue;
      const key = await this.loadKey(triple.subject);
      if (key) keys.push(key);
    }

    return keys;
  }

  /**
   * Rotate a key — revoke old and create new with same scopes.
   */
  async rotate(keyId: string): Promise<ApiKeyCreateResult> {
    const sub = this.subject(keyId);
    const oldKey = await this.loadKey(sub);
    if (!oldKey) {
      throw new Error(`mamoru-keys: key "${keyId}" not found`);
    }

    await this.revoke(keyId);
    return this.create(oldKey.agentId, oldKey.name, { scopes: oldKey.scopes });
  }

  /**
   * Remove expired keys. Returns the count of cleaned keys.
   */
  async cleanup(): Promise<number> {
    const result = await this.client.listTriples({
      predicate: this.predicate(PRED.expiresAt),
      limit: 10_000,
    });

    const now = new Date();
    let cleaned = 0;

    for (const triple of result.triples) {
      const expiresAt = new Date(String(triple.object));
      if (expiresAt < now) {
        // Delete all triples for this key subject
        const keyTriples = await this.client.listTriples({
          subject: triple.subject,
          limit: 100,
        });
        for (const kt of keyTriples.triples) {
          if (kt.id) await this.client.deleteTriple(kt.id);
        }
        cleaned++;
      }
    }

    return cleaned;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async loadKey(subject: string): Promise<ApiKey | null> {
    const result = await this.client.listTriples({ subject, limit: 100 });
    if (result.triples.length === 0) return null;

    const map = new Map<string, string>();
    for (const t of result.triples) {
      // Strip namespace prefix from predicate for easier lookup
      const shortPred = t.predicate.replace(`${this.ns}:`, "");
      map.set(shortPred, String(t.object));
    }

    const id = subject.replace(`${this.ns}:apikey:`, "");
    const keyHash = map.get(PRED.keyHash);
    if (!keyHash) return null;

    return {
      id,
      name: map.get(PRED.name) ?? "",
      agentId: map.get(PRED.agentId) ?? "",
      keyHash,
      prefix: map.get(PRED.prefix) ?? "",
      scopes: (map.get(PRED.scopes) ?? "").split(",").filter(Boolean),
      createdAt: map.get(PRED.createdAt) ?? "",
      lastUsedAt: map.get(PRED.lastUsedAt) ?? null,
      revokedAt: map.get(PRED.revokedAt) ?? null,
      expiresAt: map.get(PRED.expiresAt) ?? null,
    };
  }
}
