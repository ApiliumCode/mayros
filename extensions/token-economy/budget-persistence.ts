import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type PersistedModelEntry = {
  provider: string;
  model: string;
  calls: number;
  tokens: number;
  costUsd: number;
};

export type PersistedBudget = {
  dailyCostUsd: number;
  dailyDate: string; // "YYYY-MM-DD"
  monthlyCostUsd: number;
  monthlyKey: string; // "YYYY-MM"
  lastFlushedAt: number;
  /** Per-model usage keyed by "provider:model". */
  modelUsage?: Record<string, PersistedModelEntry>;
};

function defaultPersistedBudget(): PersistedBudget {
  const now = new Date();
  return {
    dailyCostUsd: 0,
    dailyDate: formatDate(now),
    monthlyCostUsd: 0,
    monthlyKey: formatMonth(now),
    lastFlushedAt: Date.now(),
  };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function parsePersistedModelUsage(raw: unknown): Record<string, PersistedModelEntry> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const result: Record<string, PersistedModelEntry> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const entry = val as Record<string, unknown>;
    if (typeof entry.provider !== "string" || typeof entry.model !== "string") continue;
    result[key] = {
      provider: entry.provider,
      model: entry.model,
      calls: typeof entry.calls === "number" ? entry.calls : 0,
      tokens: typeof entry.tokens === "number" ? entry.tokens : 0,
      costUsd: typeof entry.costUsd === "number" ? entry.costUsd : 0,
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolveTilde(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir();
    return join(home, p.slice(2));
  }
  return p;
}

export class BudgetPersistence {
  private readonly resolvedPath: string;

  constructor(filePath: string) {
    this.resolvedPath = resolveTilde(filePath);
  }

  async load(): Promise<PersistedBudget> {
    try {
      const raw = await readFile(this.resolvedPath, "utf-8");
      const data = JSON.parse(raw) as Partial<PersistedBudget>;
      return {
        dailyCostUsd: typeof data.dailyCostUsd === "number" ? data.dailyCostUsd : 0,
        dailyDate: typeof data.dailyDate === "string" ? data.dailyDate : formatDate(new Date()),
        monthlyCostUsd: typeof data.monthlyCostUsd === "number" ? data.monthlyCostUsd : 0,
        monthlyKey: typeof data.monthlyKey === "string" ? data.monthlyKey : formatMonth(new Date()),
        lastFlushedAt: typeof data.lastFlushedAt === "number" ? data.lastFlushedAt : Date.now(),
        modelUsage: parsePersistedModelUsage(data.modelUsage),
      };
    } catch {
      return defaultPersistedBudget();
    }
  }

  async save(data: PersistedBudget): Promise<void> {
    const dir = dirname(this.resolvedPath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.token-budget-${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, this.resolvedPath);
  }

  rolloverIfNeeded(data: PersistedBudget): PersistedBudget {
    const now = new Date();
    const today = formatDate(now);
    const thisMonth = formatMonth(now);
    let rolled = data;

    if (rolled.dailyDate !== today) {
      rolled = { ...rolled, dailyCostUsd: 0, dailyDate: today, modelUsage: undefined };
    }
    if (rolled.monthlyKey !== thisMonth) {
      rolled = { ...rolled, monthlyCostUsd: 0, monthlyKey: thisMonth };
    }
    return rolled;
  }
}
