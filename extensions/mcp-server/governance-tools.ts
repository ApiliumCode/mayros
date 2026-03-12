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
        const { join } = await import("node:path");
        const { homedir } = await import("node:os");

        // Search policy file in project dir, then user config
        const candidates = [
          join(process.cwd(), "MAYROS.md"),
          join(homedir(), ".mayros", "MAYROS.md"),
        ];

        let policyContent: string | null = null;
        let policyPath = candidates[0];
        for (const candidate of candidates) {
          try {
            await access(candidate);
            policyContent = await readFile(candidate, "utf-8");
            policyPath = candidate;
            break;
          } catch {
            // Try next candidate
          }
        }

        try {
          if (!policyContent) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `ALLOWED (no policy): No MAYROS.md found. All actions permitted.`,
                },
              ],
            };
          }

          // Pattern matching against DENY/ALLOW rules
          const denyPatterns: string[] = [];
          for (const line of policyContent.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("- DENY:")) {
              denyPatterns.push(trimmed.slice(7).trim());
            }
          }

          // Check deny rules with word-boundary matching
          for (const pattern of denyPatterns) {
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`(?:^|[\\s/\\\\.:_-])${escaped}(?:$|[\\s/\\\\.:_-])`, "i");
            if (regex.test(target) || regex.test(action)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `DENIED: "${target}" matches deny rule "${pattern}" (from ${policyPath})`,
                  },
                ],
              };
            }
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `ALLOWED: "${action}" on "${target}" — no deny rules matched (${denyPatterns.length} rules checked, from ${policyPath})`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Policy check error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },
  ];
}
