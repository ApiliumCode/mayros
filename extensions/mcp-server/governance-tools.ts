/**
 * MCP-friendly governance tools.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export function createGovernanceTools(): AdaptableTool[] {
  return [
    {
      name: "mayros_policy_check",
      description:
        "Check if an action is allowed by the project governance policies. " +
        "Evaluates tool calls, file operations, and commands against MAYROS.md rules.",
      parameters: Type.Object({
        action: Type.String({
          description: 'Action type: "tool_call", "file_write", "file_delete", "shell_command"',
        }),
        target: Type.String({
          description: "Target of the action (tool name, file path, or command)",
        }),
        details: Type.Optional(Type.String({ description: "Additional context about the action" })),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const action = params.action as string;
        const target = params.target as string;

        const { readFile, access } = await import("node:fs/promises");
        const policyPath = `${process.cwd()}/MAYROS.md`;

        try {
          await access(policyPath);
          const content = await readFile(policyPath, "utf-8");

          // Pattern matching against DENY/ALLOW rules
          const denyPatterns: string[] = [];
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("- DENY:")) {
              denyPatterns.push(trimmed.slice(7).trim());
            }
          }

          // Check deny rules
          for (const pattern of denyPatterns) {
            if (target.includes(pattern) || action.includes(pattern)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `DENIED: "${target}" matches deny rule "${pattern}"`,
                  },
                ],
              };
            }
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `ALLOWED: "${action}" on "${target}" — no deny rules matched (${denyPatterns.length} rules checked)`,
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `ALLOWED (no policy): No MAYROS.md found at ${policyPath}. All actions permitted.`,
              },
            ],
          };
        }
      },
    },
  ];
}
