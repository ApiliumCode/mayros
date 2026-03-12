/**
 * MCP-friendly budget/token economy tools.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export function createBudgetTools(): AdaptableTool[] {
  return [
    {
      name: "mayros_budget",
      description:
        "Check token usage and budget status. " +
        "Shows session spend, daily spend, and remaining budget.",
      parameters: Type.Object({}),
      execute: async () => {
        const budgetPath = `${process.env.HOME ?? "."}/.mayros/budget-state.json`;
        try {
          const { readFile } = await import("node:fs/promises");
          const data = JSON.parse(await readFile(budgetPath, "utf-8")) as {
            sessionTokens?: number;
            dailyTokens?: number;
            monthlyTokens?: number;
            sessionCostUsd?: number;
            dailyCostUsd?: number;
            monthlyCostUsd?: number;
            sessionLimit?: number;
            dailyLimit?: number;
          };

          const lines = [
            "Token Budget Status:",
            `  Session: ${data.sessionTokens?.toLocaleString() ?? 0} tokens ($${(data.sessionCostUsd ?? 0).toFixed(4)})`,
            `  Daily:   ${data.dailyTokens?.toLocaleString() ?? 0} tokens ($${(data.dailyCostUsd ?? 0).toFixed(4)})`,
            `  Monthly: ${data.monthlyTokens?.toLocaleString() ?? 0} tokens ($${(data.monthlyCostUsd ?? 0).toFixed(4)})`,
          ];
          if (data.sessionLimit) {
            lines.push(`  Session limit: ${data.sessionLimit.toLocaleString()} tokens`);
          }
          if (data.dailyLimit) {
            lines.push(`  Daily limit: ${data.dailyLimit.toLocaleString()} tokens`);
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch {
          return {
            content: [{ type: "text" as const, text: "No budget data available yet." }],
          };
        }
      },
    },
  ];
}
