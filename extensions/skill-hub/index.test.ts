import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillHubConfigSchema, tierFromScore, meetsTier, type TrustTier } from "./config.js";
import {
  generateKeyPair,
  signMessage,
  verifySignature,
  createSkillSignature,
  verifySkillSignature,
} from "./signing.js";
import {
  hashContent,
  extractPackageArchive,
  extractPackageArchiveToTemp,
  promoteDir,
  cleanupTempDir,
  type PackageArchive,
} from "./skill-packager.js";

// ============================================================================
// Config tests
// ============================================================================

describe("skillHubConfigSchema", () => {
  it("parses minimal config", () => {
    const cfg = skillHubConfigSchema.parse({});
    expect(cfg.hubUrl).toBe("https://hub.apilium.com");
    expect(cfg.cortex.host).toBe("127.0.0.1");
    expect(cfg.cortex.port).toBe(8080);
    expect(cfg.agentNamespace).toBe("mayros");
    expect(cfg.verification.requireSignature).toBe(true);
    expect(cfg.verification.polValidation).toBe(true);
    expect(cfg.verification.sandboxTest).toBe(true);
    expect(cfg.verification.sandboxTtlSeconds).toBe(60);
  });

  it("parses full config", () => {
    const cfg = skillHubConfigSchema.parse({
      hubUrl: "https://custom-hub.example.com",
      cortex: { host: "10.0.0.1", port: 9090 },
      agentNamespace: "custom-ns",
      keysDir: "/tmp/keys",
      verification: {
        requireSignature: false,
        polValidation: false,
        sandboxTest: false,
        sandboxTtlSeconds: 120,
      },
    });
    expect(cfg.hubUrl).toBe("https://custom-hub.example.com");
    expect(cfg.cortex.host).toBe("10.0.0.1");
    expect(cfg.keysDir).toBe("/tmp/keys");
    expect(cfg.verification.requireSignature).toBe(false);
    expect(cfg.verification.sandboxTtlSeconds).toBe(120);
  });

  it("rejects unknown keys", () => {
    expect(() => skillHubConfigSchema.parse({ badKey: true })).toThrow("unknown keys");
  });

  it("rejects invalid namespace", () => {
    expect(() => skillHubConfigSchema.parse({ agentNamespace: "0invalid" })).toThrow(
      "agentNamespace",
    );
  });
});

// ============================================================================
// Signing tests
// ============================================================================

describe("Ed25519 signing", () => {
  it("generates a keypair", () => {
    const keyPair = generateKeyPair();
    expect(keyPair.publicKey).toBeTruthy();
    expect(keyPair.privateKey).toBeTruthy();
    expect(typeof keyPair.publicKey).toBe("string");
    expect(typeof keyPair.privateKey).toBe("string");
  });

  it("signs and verifies a message", () => {
    const keyPair = generateKeyPair();
    const message = Buffer.from("hello world", "utf-8");

    const signature = signMessage(message, keyPair.privateKey);
    expect(typeof signature).toBe("string");

    const valid = verifySignature(message, signature, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it("rejects tampered message", () => {
    const keyPair = generateKeyPair();
    const message = Buffer.from("hello world", "utf-8");
    const signature = signMessage(message, keyPair.privateKey);

    const tampered = Buffer.from("hello world!", "utf-8");
    const valid = verifySignature(tampered, signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it("rejects wrong key", () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    const message = Buffer.from("test message", "utf-8");
    const signature = signMessage(message, keyPair1.privateKey);

    const valid = verifySignature(message, signature, keyPair2.publicKey);
    expect(valid).toBe(false);
  });
});

describe("SKILL.sig creation and verification", () => {
  it("creates and verifies a skill signature", () => {
    const keyPair = generateKeyPair();
    const fileHashes = {
      "SKILL.md": "abc123",
      "skill.ts": "def456",
    };

    const sig = createSkillSignature(fileHashes, keyPair.publicKey, keyPair.privateKey);

    expect(sig.version).toBe(1);
    expect(sig.algorithm).toBe("ed25519");
    expect(sig.publicKey).toBe(keyPair.publicKey);
    expect(sig.fileHashes).toEqual(fileHashes);
    expect(sig.timestamp).toBeTruthy();

    const valid = verifySkillSignature(sig);
    expect(valid).toBe(true);
  });

  it("rejects tampered file hashes", () => {
    const keyPair = generateKeyPair();
    const fileHashes = { "SKILL.md": "abc123" };

    const sig = createSkillSignature(fileHashes, keyPair.publicKey, keyPair.privateKey);

    // Tamper with file hashes
    sig.fileHashes["SKILL.md"] = "tampered";

    const valid = verifySkillSignature(sig);
    expect(valid).toBe(false);
  });

  it("rejects wrong version", () => {
    const keyPair = generateKeyPair();
    const sig = createSkillSignature({ "SKILL.md": "abc" }, keyPair.publicKey, keyPair.privateKey);
    sig.version = 99;

    const valid = verifySkillSignature(sig);
    expect(valid).toBe(false);
  });
});

// ============================================================================
// Packager tests
// ============================================================================

describe("hashContent", () => {
  it("hashes content deterministically", () => {
    const content = Buffer.from("hello world", "utf-8");
    const h1 = hashContent(content);
    const h2 = hashContent(content);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64); // SHA-256 hex
  });

  it("produces different hashes for different content", () => {
    const h1 = hashContent(Buffer.from("hello", "utf-8"));
    const h2 = hashContent(Buffer.from("world", "utf-8"));
    expect(h1).not.toBe(h2);
  });
});

// ============================================================================
// Phase 5.5 — Path traversal protection (Fix 1)
// ============================================================================

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "skill-hub-test-"));
  tmpDirs.push(dir);
  return dir;
}

function makeArchive(files: Array<{ path: string; content: string }>): Buffer {
  const archive: PackageArchive = {
    format: "mayros-skill-archive-v1",
    files: files.map((f) => {
      const buf = Buffer.from(f.content, "utf-8");
      return {
        path: f.path,
        hash: hashContent(buf),
        size: buf.length,
        content: buf.toString("base64"),
      };
    }),
    totalSize: files.reduce((s, f) => s + Buffer.from(f.content).length, 0),
  };
  return Buffer.from(JSON.stringify(archive), "utf-8");
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

describe("extractPackageArchive — path traversal protection", () => {
  it("blocks entries with .. in path", async () => {
    const target = makeTmpDir();
    const archive = makeArchive([{ path: "../escape.txt", content: "pwned" }]);
    await expect(extractPackageArchive(archive, target)).rejects.toThrow("Path traversal blocked");
  });

  it("blocks entries with absolute path", async () => {
    const target = makeTmpDir();
    const archive = makeArchive([{ path: "/etc/passwd", content: "root:x:0:0" }]);
    await expect(extractPackageArchive(archive, target)).rejects.toThrow("Path traversal blocked");
  });

  it("blocks entries that resolve outside target via symlink-like paths", async () => {
    const target = makeTmpDir();
    const archive = makeArchive([{ path: "subdir/../../escape.txt", content: "pwned" }]);
    await expect(extractPackageArchive(archive, target)).rejects.toThrow("Path traversal blocked");
  });

  it("allows safe relative paths", async () => {
    const target = makeTmpDir();
    const archive = makeArchive([
      { path: "SKILL.md", content: "# test" },
      { path: "src/handler.ts", content: "export default {}" },
    ]);
    const result = await extractPackageArchive(archive, target);
    expect(result.files).toEqual(["SKILL.md", "src/handler.ts"]);
  });
});

// ============================================================================
// Phase 5.5 — Temp-extract + promote (Fix 2)
// ============================================================================

describe("extractPackageArchiveToTemp + promoteDir", () => {
  it("extracts to temp dir and promotes to final dir", async () => {
    const skillsDir = makeTmpDir();
    const archive = makeArchive([{ path: "SKILL.md", content: "# hello" }]);

    const { tempDir, files } = await extractPackageArchiveToTemp(archive, skillsDir, "test-skill");
    expect(tempDir).toContain(".installing-test-skill-");
    expect(files).toEqual(["SKILL.md"]);

    // Temp dir exists, final dir does not yet
    expect(fsSync.existsSync(tempDir)).toBe(true);
    const finalDir = path.join(skillsDir, "test-skill");
    expect(fsSync.existsSync(finalDir)).toBe(false);

    // Promote
    await promoteDir(tempDir, finalDir);
    expect(fsSync.existsSync(finalDir)).toBe(true);
    expect(fsSync.existsSync(tempDir)).toBe(false);

    const content = fsSync.readFileSync(path.join(finalDir, "SKILL.md"), "utf-8");
    expect(content).toBe("# hello");
  });

  it("cleanupTempDir removes temp dir on failure", async () => {
    const skillsDir = makeTmpDir();
    const archive = makeArchive([{ path: "SKILL.md", content: "# test" }]);

    const { tempDir } = await extractPackageArchiveToTemp(archive, skillsDir, "fail-skill");
    expect(fsSync.existsSync(tempDir)).toBe(true);

    await cleanupTempDir(tempDir);
    expect(fsSync.existsSync(tempDir)).toBe(false);
  });

  it("cleans up temp dir if extraction fails", async () => {
    const skillsDir = makeTmpDir();
    // Create archive with invalid hash to trigger extraction failure
    const badArchive: PackageArchive = {
      format: "mayros-skill-archive-v1",
      files: [
        {
          path: "test.txt",
          hash: "badhash",
          size: 5,
          content: Buffer.from("hello").toString("base64"),
        },
      ],
      totalSize: 5,
    };
    const buf = Buffer.from(JSON.stringify(badArchive), "utf-8");

    await expect(extractPackageArchiveToTemp(buf, skillsDir, "bad-skill")).rejects.toThrow(
      "Hash mismatch",
    );

    // Temp dir should be cleaned up
    const entries = fsSync.readdirSync(skillsDir);
    const tempDirs = entries.filter((e) => e.startsWith(".installing-"));
    expect(tempDirs).toHaveLength(0);
  });
});

// ============================================================================
// Phase 5.5 — Config: blockUnsigned + minTrustTier (Fix 6+7)
// ============================================================================

describe("skillHubConfigSchema — blockUnsigned & minTrustTier", () => {
  it("defaults blockUnsigned to false and minTrustTier to untrusted", () => {
    const cfg = skillHubConfigSchema.parse({});
    expect(cfg.verification.blockUnsigned).toBe(false);
    expect(cfg.verification.minTrustTier).toBe("untrusted");
  });

  it("parses blockUnsigned: true", () => {
    const cfg = skillHubConfigSchema.parse({
      verification: { blockUnsigned: true },
    });
    expect(cfg.verification.blockUnsigned).toBe(true);
  });

  it("parses minTrustTier: verified", () => {
    const cfg = skillHubConfigSchema.parse({
      verification: { minTrustTier: "verified" },
    });
    expect(cfg.verification.minTrustTier).toBe("verified");
  });

  it("rejects invalid minTrustTier", () => {
    expect(() =>
      skillHubConfigSchema.parse({
        verification: { minTrustTier: "supreme" },
      }),
    ).toThrow("minTrustTier");
  });
});

// ============================================================================
// Phase 5.5 — Trust tier utilities (Fix 7)
// ============================================================================

describe("tierFromScore", () => {
  it("returns trusted for score >= 0.9", () => {
    expect(tierFromScore(0.95)).toBe("trusted");
    expect(tierFromScore(0.9)).toBe("trusted");
  });

  it("returns verified for 0.7 <= score < 0.9", () => {
    expect(tierFromScore(0.7)).toBe("verified");
    expect(tierFromScore(0.85)).toBe("verified");
  });

  it("returns basic for 0.4 <= score < 0.7", () => {
    expect(tierFromScore(0.4)).toBe("basic");
    expect(tierFromScore(0.6)).toBe("basic");
  });

  it("returns untrusted for score < 0.4", () => {
    expect(tierFromScore(0.3)).toBe("untrusted");
    expect(tierFromScore(0)).toBe("untrusted");
  });
});

describe("meetsTier", () => {
  it("untrusted meets untrusted", () => {
    expect(meetsTier("untrusted", "untrusted")).toBe(true);
  });

  it("trusted meets any tier", () => {
    expect(meetsTier("trusted", "untrusted")).toBe(true);
    expect(meetsTier("trusted", "basic")).toBe(true);
    expect(meetsTier("trusted", "verified")).toBe(true);
    expect(meetsTier("trusted", "trusted")).toBe(true);
  });

  it("basic does not meet verified", () => {
    expect(meetsTier("basic", "verified")).toBe(false);
  });

  it("untrusted does not meet basic", () => {
    expect(meetsTier("untrusted", "basic")).toBe(false);
  });
});
