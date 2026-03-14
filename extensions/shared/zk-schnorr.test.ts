import { describe, expect, it } from "vitest";
import { ristretto255 } from "@noble/curves/ed25519.js";
import {
  generateSchnorrProof,
  generateMembershipProof,
  generateHashOpening,
  proofTypeToPascalCase,
} from "./zk-schnorr.js";

// ============================================================================
// generateSchnorrProof
// ============================================================================

describe("generateSchnorrProof", () => {
  const statement = "ns:agent:a1 has capability read";
  const subject = "ns:agent:a1";
  const predicate = "ns:identity:capability";
  const object = "read";

  it("returns commitment, challenge, and response fields", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    expect(proof).toHaveProperty("commitment");
    expect(proof).toHaveProperty("challenge");
    expect(proof).toHaveProperty("response");
  });

  it("returns 32-byte arrays for all fields", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    expect(proof.commitment).toHaveLength(32);
    expect(proof.challenge).toHaveLength(32);
    expect(proof.response).toHaveLength(32);
  });

  it("all values are in 0-255 range", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    for (const field of [proof.commitment, proof.challenge, proof.response]) {
      for (const byte of field) {
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(255);
        expect(Number.isInteger(byte)).toBe(true);
      }
    }
  });

  it("commitment, challenge, and response are all different", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    const c = JSON.stringify(proof.commitment);
    const ch = JSON.stringify(proof.challenge);
    const r = JSON.stringify(proof.response);
    expect(c).not.toBe(ch);
    expect(c).not.toBe(r);
    expect(ch).not.toBe(r);
  });

  it("returns number[] (not Uint8Array)", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    expect(Array.isArray(proof.commitment)).toBe(true);
    expect(Array.isArray(proof.challenge)).toBe(true);
    expect(Array.isArray(proof.response)).toBe(true);
  });

  it("produces different outputs on each call (random nonce)", () => {
    const p1 = generateSchnorrProof(statement, subject, predicate, object);
    const p2 = generateSchnorrProof(statement, subject, predicate, object);
    expect(JSON.stringify(p1.challenge)).not.toBe(JSON.stringify(p2.challenge));
  });

  it("commitment is a valid CompressedRistretto point", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    const hex = Buffer.from(proof.commitment).toString("hex");
    // fromHex will throw if the bytes are not a valid CompressedRistretto
    expect(() => ristretto255.Point.fromHex(hex)).not.toThrow();
  });

  it("commitment can be decompressed and is not the identity point", () => {
    const proof = generateSchnorrProof(statement, subject, predicate, object);
    const hex = Buffer.from(proof.commitment).toString("hex");
    const point = ristretto255.Point.fromHex(hex);
    expect(point.is0()).toBe(false);
  });

  it("same inputs produce same commitment (deterministic public key)", () => {
    const p1 = generateSchnorrProof(statement, subject, predicate, object);
    const p2 = generateSchnorrProof(statement, subject, predicate, object);
    // commitment = P (public key) is deterministic from subject/predicate/object
    expect(JSON.stringify(p1.commitment)).toBe(JSON.stringify(p2.commitment));
  });
});

// ============================================================================
// generateMembershipProof
// ============================================================================

describe("generateMembershipProof", () => {
  const statement = "ns:agent:a1 has permission write";
  const subject = "ns:agent:a1";
  const predicate = "ns:identity:permission";
  const object = "write";
  const setType = "permissions";

  it("returns 32-byte arrays for all fields", () => {
    const proof = generateMembershipProof(statement, subject, predicate, object, setType);
    expect(proof.commitment).toHaveLength(32);
    expect(proof.challenge).toHaveLength(32);
    expect(proof.response).toHaveLength(32);
  });

  it("all values are in 0-255 range", () => {
    const proof = generateMembershipProof(statement, subject, predicate, object, setType);
    for (const field of [proof.commitment, proof.challenge, proof.response]) {
      for (const byte of field) {
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(255);
        expect(Number.isInteger(byte)).toBe(true);
      }
    }
  });

  it("commitment, challenge, and response are all different", () => {
    const proof = generateMembershipProof(statement, subject, predicate, object, setType);
    const c = JSON.stringify(proof.commitment);
    const ch = JSON.stringify(proof.challenge);
    const r = JSON.stringify(proof.response);
    expect(c).not.toBe(ch);
    expect(c).not.toBe(r);
    expect(ch).not.toBe(r);
  });

  it("differs from a Knowledge proof with same s/p/o (different secret key)", () => {
    const kProof = generateSchnorrProof(statement, subject, predicate, object);
    const mProof = generateMembershipProof(statement, subject, predicate, object, setType);
    // setType changes the secret seed, so public key (commitment) differs
    expect(JSON.stringify(kProof.commitment)).not.toBe(JSON.stringify(mProof.commitment));
  });

  it("commitment is a valid CompressedRistretto point", () => {
    const proof = generateMembershipProof(statement, subject, predicate, object, setType);
    const hex = Buffer.from(proof.commitment).toString("hex");
    expect(() => ristretto255.Point.fromHex(hex)).not.toThrow();
  });

  it("produces different challenges on each call (random nonce)", () => {
    const p1 = generateMembershipProof(statement, subject, predicate, object, setType);
    const p2 = generateMembershipProof(statement, subject, predicate, object, setType);
    expect(JSON.stringify(p1.challenge)).not.toBe(JSON.stringify(p2.challenge));
  });
});

// ============================================================================
// generateHashOpening
// ============================================================================

describe("generateHashOpening", () => {
  it("returns 32-byte commitment and salt", () => {
    const data = new TextEncoder().encode("test data");
    const opening = generateHashOpening(data);
    expect(opening.commitment).toHaveLength(32);
    expect(opening.salt).toHaveLength(32);
  });

  it("produces different outputs each call (random salt)", () => {
    const data = new TextEncoder().encode("test data");
    const o1 = generateHashOpening(data);
    const o2 = generateHashOpening(data);
    expect(JSON.stringify(o1.salt)).not.toBe(JSON.stringify(o2.salt));
  });

  it("commitment matches SHA-256(salt || data)", () => {
    const { createHash } = require("node:crypto");
    const data = new TextEncoder().encode("verify me");
    const opening = generateHashOpening(data);
    const expected = createHash("sha256").update(Buffer.from(opening.salt)).update(data).digest();
    expect(opening.commitment).toEqual(Array.from(expected));
  });
});

// ============================================================================
// proofTypeToPascalCase
// ============================================================================

describe("proofTypeToPascalCase", () => {
  it("maps 'knowledge' to 'Knowledge'", () => {
    expect(proofTypeToPascalCase("knowledge")).toBe("Knowledge");
  });

  it("maps 'schnorr' to 'Knowledge'", () => {
    expect(proofTypeToPascalCase("schnorr")).toBe("Knowledge");
  });

  it("maps 'membership' to 'Knowledge'", () => {
    expect(proofTypeToPascalCase("membership")).toBe("Knowledge");
  });

  it("maps 'equality' to 'Equality'", () => {
    expect(proofTypeToPascalCase("equality")).toBe("Equality");
  });

  it("maps 'range' to 'Range'", () => {
    expect(proofTypeToPascalCase("range")).toBe("Range");
  });

  it("maps 'hashopening' to 'HashOpening'", () => {
    expect(proofTypeToPascalCase("hashopening")).toBe("HashOpening");
  });

  it("capitalizes unknown types", () => {
    expect(proofTypeToPascalCase("custom")).toBe("Custom");
  });
});
