/**
 * Schnorr-based ZK commitment scheme for Cortex proof verification.
 *
 * Uses Schnorr proofs on Ristretto255 via @noble/curves, matching
 * Cortex's curve25519-dalek CompressedRistretto format.
 *
 * Scheme (matches aingle_zk::verify_knowledge_proof):
 *   secret_scalar  = bytesToScalar(SHA-256(subject || predicate || object))
 *   P              = secret_scalar * G          -- public key (CompressedRistretto)
 *   k              = random nonce scalar
 *   R              = k * G                      -- nonce point
 *   challenge      = SHA-256(R || P) mod L
 *   response       = (k + challenge * secret_scalar) mod L
 *   commitment     = P.toBytes()                -- public key sent as commitment
 *
 * Verification (Rust side):
 *   R' = s*G - c*P
 *   c' = SHA-256(R' || commitment)
 *   valid iff c' == challenge
 *
 * All outputs are 32-byte arrays represented as number[] (each value 0-255).
 */

import { ristretto255 } from "@noble/curves/ed25519.js";
import { createHash, randomBytes } from "node:crypto";

// ============================================================================
// Constants
// ============================================================================

/** Ristretto255 / Ed25519 group order */
const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");

/** Generator (base) point — Ristretto basepoint */
const G = ristretto255.Point.BASE;

// ============================================================================
// Helpers
// ============================================================================

function sha256(...buffers: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const buf of buffers) {
    h.update(buf);
  }
  return new Uint8Array(h.digest());
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Length-prefixed encoding to prevent concatenation collisions.
 * Each buffer is preceded by its 4-byte little-endian length.
 */
function lengthPrefixed(...buffers: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const buf of buffers) totalLen += 4 + buf.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) {
    const len = buf.length;
    out[offset] = len & 0xff;
    out[offset + 1] = (len >> 8) & 0xff;
    out[offset + 2] = (len >> 16) & 0xff;
    out[offset + 3] = (len >> 24) & 0xff;
    offset += 4;
    out.set(buf, offset);
    offset += len;
  }
  return out;
}

function toNumberArray(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

/**
 * Interpret a 32-byte array as a little-endian unsigned integer and reduce mod L.
 * Compatible with curve25519-dalek Scalar::from_bytes_mod_order.
 */
function bytesToScalar(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return ((n % L) + L) % L;
}

/**
 * Encode a scalar as a 32-byte little-endian array.
 */
function scalarToNumberArray(s: bigint): number[] {
  const result = new Array<number>(32).fill(0);
  let val = ((s % L) + L) % L;
  for (let i = 0; i < 32; i++) {
    result[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return result;
}

/**
 * Ensure a scalar is non-zero. If zero, return 1n.
 * A zero scalar would produce the identity point.
 */
function ensureNonZero(s: bigint): bigint {
  return s === 0n ? 1n : s;
}

// ============================================================================
// Core proof generation
// ============================================================================

/**
 * Generate a Schnorr proof on Ristretto255 given a secret key seed.
 *
 * Protocol matches aingle_zk::verify_knowledge_proof:
 *   commitment = P (public key), NOT the nonce R
 *   challenge  = H(R || P)
 *   response   = k + c * x  (additive, not subtractive)
 *
 * @param secretSeed - SHA-256 hash used to derive the secret scalar
 * @returns commitment (public key), challenge (hash), response (scalar)
 */
function schnorrProve(secretSeed: Uint8Array): {
  commitment: number[];
  challenge: number[];
  response: number[];
} {
  // Derive secret scalar from seed
  const x = ensureNonZero(bytesToScalar(secretSeed));

  // Public key P = x * G (CompressedRistretto point)
  const P = G.multiply(x);
  const pBytes = P.toBytes();

  // Random nonce
  const nonceBytes = randomBytes(32);
  const k = ensureNonZero(bytesToScalar(nonceBytes));

  // R = k * G (nonce point)
  const R = G.multiply(k);
  const rBytes = R.toBytes();

  // Challenge c = SHA-256(R || P) — matches Rust verify_knowledge_proof
  const cBytes = sha256(rBytes, pBytes);
  const c = bytesToScalar(cBytes);

  // Response s = k + c * x — matches Rust's s = k + c*secret
  const s = (((k + c * x) % L) + L) % L;

  return {
    commitment: toNumberArray(pBytes), // P (public key)
    challenge: toNumberArray(cBytes),
    response: scalarToNumberArray(s),
  };
}

// ============================================================================
// Proof generation (public API)
// ============================================================================

export type SchnorrProofFields = {
  commitment: number[];
  challenge: number[];
  response: number[];
};

/**
 * Generate a Schnorr ZK proof for a Knowledge statement.
 *
 * The secret is derived from subject + predicate + object. Cortex can verify
 * knowledge of the secret without it being revealed.
 */
export function generateSchnorrProof(
  _statement: string,
  subject: string,
  predicate: string,
  object: string,
): SchnorrProofFields {
  const secretSeed = sha256(lengthPrefixed(toBytes(subject), toBytes(predicate), toBytes(object)));
  return schnorrProve(secretSeed);
}

/**
 * Generate a Schnorr ZK proof for a permission/membership claim.
 *
 * Uses Knowledge proof type (Cortex Membership requires Merkle trees which
 * are not available on the JS side). The setType is bound into the secret
 * derivation for domain separation.
 */
export function generateMembershipProof(
  _statement: string,
  subject: string,
  predicate: string,
  object: string,
  setType: string,
): SchnorrProofFields {
  const secretSeed = sha256(
    lengthPrefixed(toBytes(subject), toBytes(predicate), toBytes(object), toBytes(setType)),
  );
  return schnorrProve(secretSeed);
}

export type HashOpeningFields = {
  commitment: number[];
  salt: number[];
};

/**
 * Generate a hash-based commitment opening proof.
 * Produces SHA-256(salt || data) compatible with aingle_zk::HashCommitment.
 */
export function generateHashOpening(data: Uint8Array): HashOpeningFields {
  const salt = randomBytes(32);
  const hash = sha256(salt, data);
  return {
    commitment: toNumberArray(hash),
    salt: toNumberArray(salt),
  };
}

/**
 * Map a lowercase proof type string to PascalCase for Cortex proof_data.type.
 */
export function proofTypeToPascalCase(proofType: string): string {
  const map: Record<string, string> = {
    knowledge: "Knowledge",
    schnorr: "Knowledge",
    membership: "Knowledge",
    equality: "Equality",
    range: "Range",
    hashopening: "HashOpening",
  };
  return map[proofType] ?? proofType.charAt(0).toUpperCase() + proofType.slice(1);
}
