/**
 * Mamoru Vault — Encrypted secrets management
 *
 * Store, retrieve, rotate, and version secrets with AES-256-GCM encryption.
 * Secrets are encrypted client-side before being persisted to Cortex triples,
 * so the sidecar never sees plaintext values.
 *
 * Key derivation: scrypt (N=131072, r=8, p=1) from master password + random salt.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import type { CortexClientLike } from "../shared/cortex-client.js";

// ── Types ────────────────────────────────────────────────────────────────

export type Secret = {
  id: string;
  name: string;            // e.g., "ANTHROPIC_API_KEY"
  version: number;
  encryptedValue: string;  // AES-256-GCM encrypted (base64)
  iv: string;              // initialization vector (base64)
  tag: string;             // GCM auth tag (base64)
  salt: string;            // scrypt salt (base64)
  scope: "global" | "venture" | "agent";
  scopeId?: string;        // venture or agent ID
  createdAt: string;
  rotatedAt: string | null;
};

export type SecretMetadata = {
  name: string;
  version: number;
  scope: string;
  createdAt: string;
};

// ── Constants ────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** Regex for valid secret names: starts with letter or underscore, alphanumeric + underscore only */
const SECRET_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ── Predicate constants ─────────────────────────────────────────────────

const PRED = {
  encrypted: "secret:encrypted",
  iv: "secret:iv",
  tag: "secret:tag",
  salt: "secret:salt",
  scope: "secret:scope",
  scopeId: "secret:scopeId",
  version: "secret:version",
  createdAt: "secret:createdAt",
  rotatedAt: "secret:rotatedAt",
  name: "secret:name",
} as const;

// ── Implementation ───────────────────────────────────────────────────────

export class MamoruVault {
  private readonly ns: string;
  private encryptionKey: Buffer | null;
  private readonly client: CortexClientLike;

  constructor(client: CortexClientLike, ns: string, password: string) {
    if (!password) {
      throw new Error(
        "Vault key is required. Set MAYROS_VAULT_KEY env var or provide vaultKey option.",
      );
    }
    this.client = client;
    this.ns = ns;
    // Derive a key with a temporary salt for password validation;
    // actual encryption uses per-secret random salts
    this.encryptionKey = Buffer.from(password, "utf8");
  }

  /**
   * Derive a 256-bit encryption key from a password and salt using scrypt.
   */
  private deriveKey(password: Buffer, salt: Buffer): Buffer {
    return scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 256 * 1024 * 1024, // 256 MB — required for N=131072, r=8
    });
  }

  /**
   * Zero the encryption key and release it.
   * Call this when the vault is no longer needed.
   */
  destroy(): void {
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
      this.encryptionKey = null;
    }
  }

  // ── Subject helpers ─────────────────────────────────────────────────

  private subject(name: string, version: number): string {
    return `${this.ns}:secret:${name}:${version}`;
  }

  private predicate(pred: string): string {
    return `${this.ns}:${pred}`;
  }

  private requireKey(): Buffer {
    if (!this.encryptionKey) {
      throw new Error("Vault has been destroyed — encryption key is no longer available");
    }
    return this.encryptionKey;
  }

  // ── Encryption ─────────────────────────────────────────────────────

  private encrypt(plaintext: string): { encrypted: string; iv: string; tag: string; salt: string } {
    const password = this.requireKey();
    const salt = randomBytes(SALT_BYTES);
    const key = this.deriveKey(password, salt);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encBuf = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      encrypted: encBuf.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      salt: salt.toString("base64"),
    };
  }

  private decrypt(encrypted: string, iv: string, tag: string, salt: string): string {
    const password = this.requireKey();
    const key = this.deriveKey(password, Buffer.from(salt, "base64"));
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Store a secret. Encrypts with AES-256-GCM before persisting.
   */
  async store(
    name: string,
    value: string,
    opts?: { scope?: "global" | "venture" | "agent"; scopeId?: string },
  ): Promise<Secret> {
    if (!SECRET_NAME_RE.test(name)) {
      throw new Error(
        `Invalid secret name "${name}". Names must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`,
      );
    }

    const scope = opts?.scope ?? "global";
    const version = await this.currentVersion(name) + 1;
    const now = new Date().toISOString();
    const { encrypted, iv, tag, salt } = this.encrypt(value);

    const sub = this.subject(name, version);
    const triples: Array<{ subject: string; predicate: string; object: string }> = [
      { subject: sub, predicate: this.predicate(PRED.encrypted), object: encrypted },
      { subject: sub, predicate: this.predicate(PRED.iv), object: iv },
      { subject: sub, predicate: this.predicate(PRED.tag), object: tag },
      { subject: sub, predicate: this.predicate(PRED.salt), object: salt },
      { subject: sub, predicate: this.predicate(PRED.scope), object: scope },
      { subject: sub, predicate: this.predicate(PRED.version), object: String(version) },
      { subject: sub, predicate: this.predicate(PRED.name), object: name },
      { subject: sub, predicate: this.predicate(PRED.createdAt), object: now },
    ];

    if (opts?.scopeId) {
      triples.push({
        subject: sub,
        predicate: this.predicate(PRED.scopeId),
        object: opts.scopeId,
      });
    }

    if (version > 1) {
      triples.push({
        subject: sub,
        predicate: this.predicate(PRED.rotatedAt),
        object: now,
      });
    }

    for (const triple of triples) {
      await this.client.createTriple(triple);
    }

    const secret: Secret = {
      id: sub,
      name,
      version,
      encryptedValue: encrypted,
      iv,
      tag,
      salt,
      scope,
      scopeId: opts?.scopeId,
      createdAt: now,
      rotatedAt: version > 1 ? now : null,
    };

    return secret;
  }

  /**
   * Retrieve and decrypt a secret by name.
   * Returns null if the secret does not exist.
   */
  async retrieve(
    name: string,
    opts?: { scope?: string; scopeId?: string },
  ): Promise<string | null> {
    const version = await this.currentVersion(name);
    if (version === 0) return null;

    const sub = this.subject(name, version);
    const result = await this.client.listTriples({ subject: sub, limit: 100 });
    if (result.triples.length === 0) return null;

    const map = this.triplesMap(result.triples);
    const encrypted = map.get(PRED.encrypted);
    const iv = map.get(PRED.iv);
    const tag = map.get(PRED.tag);
    const salt = map.get(PRED.salt);

    if (encrypted === undefined || !iv || !tag || !salt) return null;

    // Scope filtering
    if (opts?.scope) {
      const storedScope = map.get(PRED.scope);
      if (storedScope !== opts.scope) return null;
    }

    try {
      return this.decrypt(encrypted, iv, tag, salt);
    } catch {
      return null;
    }
  }

  /**
   * Rotate a secret — store new encrypted value with incremented version.
   * Old versions are kept for rollback.
   */
  async rotate(
    name: string,
    newValue: string,
    opts?: { scope?: "global" | "venture" | "agent"; scopeId?: string },
  ): Promise<Secret> {
    return this.store(name, newValue, opts);
  }

  /**
   * List secret metadata (never returns values).
   */
  async list(opts?: { scope?: string }): Promise<SecretMetadata[]> {
    const result = await this.client.listTriples({
      predicate: this.predicate(PRED.name),
      limit: 10_000,
    });

    // Group by name — keep highest version
    const seen = new Map<string, { version: number; subject: string }>();
    for (const triple of result.triples) {
      const name = String(triple.object);
      // Extract version from subject: {ns}:secret:{name}:{version}
      const parts = triple.subject.split(":");
      const ver = parseInt(parts[parts.length - 1] ?? "0", 10) || 0;

      const existing = seen.get(name);
      if (!existing || ver > existing.version) {
        seen.set(name, { version: ver, subject: triple.subject });
      }
    }

    const items: SecretMetadata[] = [];
    for (const [name, info] of seen) {
      const sub = info.subject;
      const subTriples = await this.client.listTriples({ subject: sub, limit: 100 });
      const map = this.triplesMap(subTriples.triples);

      const scope = map.get(PRED.scope) ?? "global";
      if (opts?.scope && scope !== opts.scope) continue;

      items.push({
        name,
        version: info.version,
        scope,
        createdAt: map.get(PRED.createdAt) ?? "",
      });
    }

    return items;
  }

  /**
   * Delete all versions of a secret.
   */
  async delete(name: string): Promise<void> {
    const version = await this.currentVersion(name);
    for (let v = 1; v <= version; v++) {
      const sub = this.subject(name, v);
      const result = await this.client.listTriples({ subject: sub, limit: 100 });
      for (const triple of result.triples) {
        if (triple.id) await this.client.deleteTriple(triple.id);
      }
    }
  }

  /**
   * Check if a secret exists.
   */
  async exists(name: string): Promise<boolean> {
    return (await this.currentVersion(name)) > 0;
  }

  /**
   * Decrypt multiple secrets and return as an env var map.
   * Useful for injecting into agent processes.
   */
  async exportEnv(names?: string[]): Promise<Record<string, string>> {
    const targetNames = names ?? (await this.list()).map((s) => s.name);
    const env: Record<string, string> = {};

    for (const name of targetNames) {
      const value = await this.retrieve(name);
      if (value !== null) {
        env[name] = value;
      }
    }

    return env;
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Find the current (highest) version number for a secret name.
   */
  private async currentVersion(name: string): Promise<number> {
    const result = await this.client.listTriples({
      predicate: this.predicate(PRED.name),
      limit: 10_000,
    });

    let maxVersion = 0;
    for (const triple of result.triples) {
      if (String(triple.object) !== name) continue;
      const parts = triple.subject.split(":");
      const ver = parseInt(parts[parts.length - 1] ?? "0", 10) || 0;
      if (ver > maxVersion) maxVersion = ver;
    }

    return maxVersion;
  }

  private triplesMap(triples: Array<{ predicate: string; object: unknown }>): Map<string, string> {
    const map = new Map<string, string>();
    for (const t of triples) {
      const shortPred = t.predicate.replace(`${this.ns}:`, "");
      map.set(shortPred, String(t.object));
    }
    return map;
  }
}
