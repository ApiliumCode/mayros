import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPair, type Ed25519KeyPair } from "./signing.js";

const PUB_KEY_FILE = "author.pub";
const PRIV_KEY_FILE = "author.key";

export class Keystore {
  constructor(private keysDir: string) {}

  async init(passphrase?: string): Promise<Ed25519KeyPair> {
    await mkdir(this.keysDir, { recursive: true });

    // Check if keys already exist
    const exists = await this.hasKeys();
    if (exists) {
      throw new Error(`Keypair already exists in ${this.keysDir}. Use 'keys show' to view.`);
    }

    const keyPair = generateKeyPair(passphrase);

    await writeFile(join(this.keysDir, PUB_KEY_FILE), keyPair.publicKey, "utf-8");
    await writeFile(join(this.keysDir, PRIV_KEY_FILE), keyPair.privateKey, {
      encoding: "utf-8",
      mode: 0o600,
    });

    return keyPair;
  }

  async hasKeys(): Promise<boolean> {
    try {
      await access(join(this.keysDir, PUB_KEY_FILE));
      await access(join(this.keysDir, PRIV_KEY_FILE));
      return true;
    } catch {
      return false;
    }
  }

  async loadPublicKey(): Promise<string> {
    return (await readFile(join(this.keysDir, PUB_KEY_FILE), "utf-8")).trim();
  }

  async loadPrivateKey(): Promise<string> {
    return (await readFile(join(this.keysDir, PRIV_KEY_FILE), "utf-8")).trim();
  }

  async loadKeyPair(): Promise<Ed25519KeyPair> {
    const publicKey = await this.loadPublicKey();
    const privateKey = await this.loadPrivateKey();
    return { publicKey, privateKey };
  }

  async exportPublicKey(): Promise<string> {
    const pub = await this.loadPublicKey();
    return pub;
  }
}
