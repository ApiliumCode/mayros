import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type AuditEntry = {
  seq: number;
  timestamp: string;
  event: string;
  actor: string | undefined;
  decision: "allow" | "deny" | "warn" | "flagged";
  context: Record<string, unknown>;
  prevHmac: string;
  hmac: string;
};

export class AuditTrail {
  private seq = 0;
  private prevHmac = "genesis";
  private hmacKey: Buffer | null = null;
  private logPath: string;
  private keyPath: string;
  private initialized = false;
  private writeLock: Promise<void> = Promise.resolve();
  public lastWriteError: Error | null = null;

  constructor(auditLogPath: string, hmacSecret?: string) {
    this.logPath = auditLogPath.replace(/^~/, os.homedir());
    this.keyPath = path.join(path.dirname(this.logPath), "hmac.key");
    if (hmacSecret) {
      this.hmacKey = Buffer.from(hmacSecret, "hex");
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });

    // Load or generate HMAC key
    if (!this.hmacKey) {
      try {
        const keyData = await fs.readFile(this.keyPath);
        this.hmacKey = keyData;
      } catch {
        this.hmacKey = randomBytes(32);
        await fs.writeFile(this.keyPath, this.hmacKey, { mode: 0o600 });
      }
    }

    // Load existing log to determine seq and prevHmac
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]!) as AuditEntry;
        this.seq = last.seq;
        this.prevHmac = last.hmac;
      }
    } catch {
      // New log
    }

    this.initialized = true;
  }

  private computeHmac(data: string): string {
    if (!this.hmacKey) return "no-key";
    return createHmac("sha256", this.hmacKey).update(data).digest("hex");
  }

  async log(
    event: string,
    actor: string | undefined,
    decision: AuditEntry["decision"],
    context: Record<string, unknown>,
  ): Promise<AuditEntry> {
    // Serialize writes with promise-based mutex
    let releaseLock!: () => void;
    const acquired = new Promise<void>((r) => {
      releaseLock = r;
    });
    const prev = this.writeLock;
    this.writeLock = acquired;
    await prev;

    try {
      await this.init();

      this.seq++;
      const entry: Omit<AuditEntry, "hmac"> & { hmac?: string } = {
        seq: this.seq,
        timestamp: new Date().toISOString(),
        event,
        actor,
        decision,
        context,
        prevHmac: this.prevHmac,
      };

      // Compute HMAC over the entry (without hmac field)
      const entryData = JSON.stringify(entry);
      const hmac = this.computeHmac(entryData);
      const fullEntry: AuditEntry = { ...entry, hmac } as AuditEntry;

      this.prevHmac = hmac;

      // Append to JSONL — handle disk-full / write errors gracefully
      try {
        await fs.appendFile(this.logPath, JSON.stringify(fullEntry) + "\n");
        this.lastWriteError = null;
      } catch (err) {
        this.lastWriteError = err instanceof Error ? err : new Error(String(err));
        process.stderr.write(`[osameru] audit write failed: ${this.lastWriteError.message}\n`);
        // Do NOT throw — audit failure should not crash the system
      }

      return fullEntry;
    } finally {
      releaseLock();
    }
  }

  async verify(): Promise<{ valid: boolean; entries: number; firstInvalid?: number }> {
    await this.init();

    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      let prevHmac = "genesis";

      for (let i = 0; i < lines.length; i++) {
        const entry = JSON.parse(lines[i]!) as AuditEntry;

        if (entry.prevHmac !== prevHmac) {
          return { valid: false, entries: lines.length, firstInvalid: i };
        }

        // Recompute HMAC
        const withoutHmac = { ...entry };
        delete (withoutHmac as Record<string, unknown>).hmac;
        const expected = this.computeHmac(JSON.stringify(withoutHmac));

        if (entry.hmac !== expected) {
          return { valid: false, entries: lines.length, firstInvalid: i };
        }

        prevHmac = entry.hmac;
      }

      return { valid: true, entries: lines.length };
    } catch {
      return { valid: true, entries: 0 };
    }
  }

  async query(filter?: {
    event?: string;
    actor?: string;
    decision?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    await this.init();

    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      let entries = lines.map((l) => JSON.parse(l) as AuditEntry);

      if (filter?.event) entries = entries.filter((e) => e.event === filter.event);
      if (filter?.actor) entries = entries.filter((e) => e.actor === filter.actor);
      if (filter?.decision) entries = entries.filter((e) => e.decision === filter.decision);
      if (filter?.limit) entries = entries.slice(-filter.limit);

      return entries;
    } catch {
      return [];
    }
  }
}
