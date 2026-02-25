import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from "node:crypto";

export type Ed25519KeyPair = {
  publicKey: string; // base64
  privateKey: string; // base64 (encrypted PEM)
};

export type SignatureData = {
  version: number;
  algorithm: "ed25519";
  publicKey: string;
  signature: string;
  timestamp: string;
  fileHashes: Record<string, string>;
};

/**
 * Generate a new Ed25519 keypair.
 */
export function generateKeyPair(passphrase?: string): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: passphrase ? "aes-256-cbc" : undefined,
      passphrase: passphrase || undefined,
    },
  });

  // Extract raw public key bytes and encode as base64
  const pubKeyObj = createPublicKey(publicKey);
  const pubKeyDer = pubKeyObj.export({ type: "spki", format: "der" });
  const pubKeyBase64 = pubKeyDer.toString("base64");

  // Store private key as base64 PEM
  const privKeyBase64 = Buffer.from(privateKey).toString("base64");

  return { publicKey: pubKeyBase64, privateKey: privKeyBase64 };
}

/**
 * Sign a message using an Ed25519 private key.
 */
export function signMessage(
  message: Buffer,
  privateKeyBase64: string,
  passphrase?: string,
): string {
  const pemBytes = Buffer.from(privateKeyBase64, "base64");
  const pem = pemBytes.toString("utf-8");

  const keyObj = createPrivateKey({
    key: pem,
    format: "pem",
    type: "pkcs8",
    passphrase: passphrase || undefined,
  });

  const signature = sign(null, message, keyObj);
  return signature.toString("base64");
}

/**
 * Verify a message signature using an Ed25519 public key.
 */
export function verifySignature(
  message: Buffer,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  const pubKeyDer = Buffer.from(publicKeyBase64, "base64");
  const keyObj = createPublicKey({ key: pubKeyDer, format: "der", type: "spki" });
  const signatureBuf = Buffer.from(signatureBase64, "base64");

  return verify(null, message, keyObj, signatureBuf);
}

/**
 * Create a SKILL.sig structure from file hashes and a private key.
 */
export function createSkillSignature(
  fileHashes: Record<string, string>,
  publicKeyBase64: string,
  privateKeyBase64: string,
  passphrase?: string,
): SignatureData {
  // Canonical form: sorted keys, concatenated hash values
  const canonical = Object.keys(fileHashes)
    .sort()
    .map((k) => `${k}:${fileHashes[k]}`)
    .join("\n");

  const message = Buffer.from(canonical, "utf-8");
  const signature = signMessage(message, privateKeyBase64, passphrase);

  return {
    version: 1,
    algorithm: "ed25519",
    publicKey: publicKeyBase64,
    signature,
    timestamp: new Date().toISOString(),
    fileHashes,
  };
}

/**
 * Verify a SKILL.sig structure against its declared file hashes.
 */
export function verifySkillSignature(sig: SignatureData): boolean {
  if (sig.version !== 1 || sig.algorithm !== "ed25519") {
    return false;
  }

  const canonical = Object.keys(sig.fileHashes)
    .sort()
    .map((k) => `${k}:${sig.fileHashes[k]}`)
    .join("\n");

  const message = Buffer.from(canonical, "utf-8");
  return verifySignature(message, sig.signature, sig.publicKey);
}
