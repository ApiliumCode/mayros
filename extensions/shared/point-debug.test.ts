import { describe, it, expect } from "vitest";
import { ristretto255 } from "@noble/curves/ed25519.js";
import { generateSchnorrProof } from "./zk-schnorr.js";

describe("point format debug", () => {
  it("shows commitment format", () => {
    const proof = generateSchnorrProof("test", "s", "p", "o");
    const hex = Buffer.from(proof.commitment).toString("hex");
    console.log("commitment hex:", hex);
    console.log("length:", proof.commitment.length);

    // Verify it's a valid CompressedRistretto point
    const pt = ristretto255.Point.fromHex(hex);
    console.log("Ristretto point decompressed OK");
    console.log("re-compressed hex:", pt.toHex());
    console.log("matches:", pt.toHex() === hex);

    expect(pt.is0()).toBe(false);
    expect(pt.toHex()).toBe(hex);
  });
});
