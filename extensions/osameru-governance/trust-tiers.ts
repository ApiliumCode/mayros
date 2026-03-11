import fs from "node:fs/promises";
import path from "node:path";

export type TrustTier = 0 | 1 | 2;

export type TrustRecord = {
  agentId: string;
  tier: TrustTier;
  lastEvaluated: number;
  evaluationCount: number;
};

export class TrustManager {
  private records = new Map<string, TrustRecord>();
  private promotionThreshold: number;
  private demotionThreshold: number;
  private persistPath?: string;

  constructor(opts: {
    promotionThreshold: number;
    demotionThreshold: number;
    persistPath?: string;
  }) {
    this.promotionThreshold = opts.promotionThreshold;
    this.demotionThreshold = opts.demotionThreshold;
    this.persistPath = opts.persistPath;
  }

  async init(): Promise<void> {
    await this.load();
  }

  getTier(agentId: string): TrustTier {
    return this.records.get(agentId)?.tier ?? 0;
  }

  getRecord(agentId: string): TrustRecord {
    let record = this.records.get(agentId);
    if (!record) {
      record = { agentId, tier: 0, lastEvaluated: Date.now(), evaluationCount: 0 };
      this.records.set(agentId, record);
    }
    return record;
  }

  evaluatePromotion(agentId: string, emaScore: number): TrustTier {
    const record = this.getRecord(agentId);
    record.evaluationCount++;
    record.lastEvaluated = Date.now();

    if (emaScore >= this.promotionThreshold && record.tier < 2) {
      // Require at least 5 evaluations before promotion
      if (record.evaluationCount >= 5) {
        record.tier = Math.min(2, record.tier + 1) as TrustTier;
      }
    } else if (emaScore <= this.demotionThreshold && record.tier > 0) {
      record.tier = Math.max(0, record.tier - 1) as TrustTier;
    }

    this.records.set(agentId, record);
    void this.save();
    return record.tier;
  }

  getAllRecords(): TrustRecord[] {
    return [...this.records.values()];
  }

  setTier(agentId: string, tier: TrustTier): void {
    const record = this.getRecord(agentId);
    record.tier = tier;
    this.records.set(agentId, record);
    void this.save();
  }

  async save(): Promise<void> {
    if (!this.persistPath) return;
    const data = JSON.stringify(this.getAllRecords(), null, 2);
    const tmpPath = this.persistPath + ".tmp";
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(tmpPath, data, "utf-8");
      await fs.rename(tmpPath, this.persistPath);
    } catch {
      // Best-effort persistence — don't crash if disk write fails
    }
  }

  private async load(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const data = await fs.readFile(this.persistPath, "utf-8");
      const parsed: TrustRecord[] = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const record of parsed) {
        if (record.agentId && typeof record.tier === "number") {
          this.records.set(record.agentId, record);
        }
      }
    } catch {
      // File doesn't exist or is corrupted — start fresh
    }
  }
}
