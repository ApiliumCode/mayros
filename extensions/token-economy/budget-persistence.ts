import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type PersistedBudget = {
  dailyCostUsd: number;
  dailyDate: string; // "YYYY-MM-DD"
  monthlyCostUsd: number;
  monthlyKey: string; // "YYYY-MM"
  lastFlushedAt: number;
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
      rolled = { ...rolled, dailyCostUsd: 0, dailyDate: today };
    }
    if (rolled.monthlyKey !== thisMonth) {
      rolled = { ...rolled, monthlyCostUsd: 0, monthlyKey: thisMonth };
    }
    return rolled;
  }
}
