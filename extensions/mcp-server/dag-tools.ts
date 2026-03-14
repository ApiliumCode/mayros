/**
 * MCP-friendly Semantic DAG tools.
 *
 * Exposes 10 tools for DAG audit, time-travel, history, action lookup,
 * chain inspection, export, diff, stats, verification, and pruning.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export type DagToolDeps = {
  cortexBaseUrl: string;
  namespace?: string;
  authToken?: string;
};

/** Safety limit: truncate export output to avoid blowing up LLM context. */
const MAX_EXPORT_CHARS = 256 * 1024;

/** Default timeout for Cortex HTTP requests (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;

type ToolContent = { content: Array<{ type: "text"; text: string }> };

function textResult(text: string): ToolContent {
  return { content: [{ type: "text" as const, text }] };
}

async function fetchDag(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  unavailableMsg: string,
  onSuccess: (res: Response) => Promise<ToolContent>,
): Promise<ToolContent> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return textResult(`${errorPrefix}: ${res.statusText}`);
    }
    return await onSuccess(res);
  } catch {
    return textResult(unavailableMsg);
  }
}

export function createDagTools(deps: DagToolDeps): AdaptableTool[] {
  const { cortexBaseUrl } = deps;

  const defaultHeaders: Record<string, string> = {};
  if (deps.authToken) {
    defaultHeaders["Authorization"] = deps.authToken;
  }

  const postHeaders: Record<string, string> = {
    ...defaultHeaders,
    "Content-Type": "application/json",
  };

  const getInit: RequestInit = { headers: defaultHeaders };

  return [
    {
      name: "mayros_dag_tips",
      description:
        "Get the current DAG tip hashes. " +
        "Tips are the latest actions with no children — the frontier of the DAG.",
      parameters: Type.Object({}),
      execute: async () =>
        fetchDag(
          `${cortexBaseUrl}/api/v1/dag/tips`,
          getInit,
          "DAG tips failed",
          "Cortex unavailable. DAG tips cannot be retrieved.",
          async (res) => {
            const data = (await res.json()) as { tips: string[]; count: number };
            return textResult(`DAG has ${data.count} tip(s):\n${data.tips.join("\n")}`);
          },
        ),
    },

    {
      name: "mayros_dag_action",
      description:
        "Get details of a specific DAG action by its hash. " +
        "Returns author, sequence number, timestamp, payload type, parents, and signature status.",
      parameters: Type.Object({
        hash: Type.String({ description: "DAG action hash to look up" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const hash = encodeURIComponent(params.hash as string);
        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/action/${hash}`,
          getInit,
          "DAG action lookup failed",
          "Cortex unavailable. DAG action lookup failed.",
          async (res) => {
            const a = (await res.json()) as {
              hash: string;
              parents: string[];
              author: string;
              seq: number;
              timestamp: string;
              payload_type: string;
              payload_summary: string;
              signed: boolean;
              signature: string | null;
            };

            const parentsList =
              a.parents.length === 0
                ? "(genesis)"
                : a.parents.map((p) => p.slice(0, 12) + "…").join(", ");
            const sig = a.signed ? ` sig:${a.signature?.slice(0, 16) ?? "?"}…` : "";

            return textResult(
              `Action ${a.hash.slice(0, 12)}…\n` +
                `  Author: ${a.author}\n` +
                `  Seq: ${a.seq}\n` +
                `  Timestamp: ${a.timestamp}\n` +
                `  Type: ${a.payload_type}\n` +
                `  Summary: ${a.payload_summary}\n` +
                `  Parents: ${parentsList}\n` +
                `  Signed: ${a.signed}${sig}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_chain",
      description:
        "Get the DAG action chain for a specific author/node. " +
        "Shows all actions created by a given author in sequence order.",
      parameters: Type.Object({
        author: Type.String({ description: "Author node ID to query chain for" }),
        limit: Type.Optional(
          Type.Number({ description: "Max actions to return (default 20, max 500)" }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const limit = Math.min((params.limit as number) ?? 20, 500);
        const qs = new URLSearchParams();
        qs.set("author", params.author as string);
        qs.set("limit", String(limit));

        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/chain?${qs}`,
          getInit,
          "DAG chain failed",
          "Cortex unavailable. DAG chain cannot be retrieved.",
          async (res) => {
            const data = (await res.json()) as {
              actions: Array<{
                hash: string;
                seq: number;
                timestamp: string;
                payload_type: string;
                payload_summary: string;
              }>;
            };

            if (!data.actions || data.actions.length === 0) {
              return textResult(`No DAG actions for author "${String(params.author)}".`);
            }

            const lines = data.actions.map(
              (a) =>
                `  #${a.seq} [${a.payload_type}] ${a.payload_summary} (${a.hash.slice(0, 12)}…)`,
            );

            return textResult(
              `${data.actions.length} action(s) by "${String(params.author)}":\n${lines.join("\n")}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_history",
      description:
        "Get the DAG action history for a specific subject. " +
        "Shows all mutations that affected a given subject in the knowledge graph.",
      parameters: Type.Object({
        subject: Type.String({
          description: "Subject to query history for (e.g., 'project:api')",
        }),
        limit: Type.Optional(
          Type.Number({ description: "Max actions to return (default 20, max 500)" }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const limit = Math.min((params.limit as number) ?? 20, 500);
        const qs = new URLSearchParams();
        qs.set("subject", params.subject as string);
        qs.set("limit", String(limit));

        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/history?${qs}`,
          getInit,
          "DAG history failed",
          "Cortex unavailable. DAG history cannot be retrieved.",
          async (res) => {
            const data = (await res.json()) as {
              actions: Array<{
                hash: string;
                seq: number;
                timestamp: string;
                payload_type: string;
                payload_summary: string;
              }>;
            };

            if (!data.actions || data.actions.length === 0) {
              return textResult(`No DAG history for subject "${String(params.subject)}".`);
            }

            const lines = data.actions.map(
              (a) =>
                `  #${a.seq} [${a.payload_type}] ${a.payload_summary} (${a.hash.slice(0, 12)}…)`,
            );

            return textResult(
              `${data.actions.length} action(s) for "${String(params.subject)}":\n${lines.join("\n")}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_time_travel",
      description:
        "Time-travel to a specific DAG action hash. " +
        "Reconstructs the knowledge graph state as it was at that point in time.",
      parameters: Type.Object({
        hash: Type.String({ description: "DAG action hash to travel to" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const hash = encodeURIComponent(params.hash as string);
        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/at/${hash}`,
          getInit,
          "DAG time-travel failed",
          "Cortex unavailable. DAG time-travel failed.",
          async (res) => {
            const data = (await res.json()) as {
              target_hash: string;
              target_timestamp: string;
              actions_replayed: number;
              triple_count: number;
            };

            return textResult(
              `Time-travel to ${data.target_hash.slice(0, 12)}…\n` +
                `  Timestamp: ${data.target_timestamp}\n` +
                `  Actions replayed: ${data.actions_replayed}\n` +
                `  Triples at that point: ${data.triple_count}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_diff",
      description:
        "Show the diff between two DAG action hashes. " +
        "Lists all actions between the two points.",
      parameters: Type.Object({
        from: Type.String({ description: "Starting action hash" }),
        to: Type.String({ description: "Ending action hash" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const qs = new URLSearchParams();
        qs.set("from", params.from as string);
        qs.set("to", params.to as string);

        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/diff?${qs}`,
          getInit,
          "DAG diff failed",
          "Cortex unavailable. DAG diff failed.",
          async (res) => {
            const data = (await res.json()) as {
              from: string;
              to: string;
              action_count: number;
              actions: Array<{
                hash: string;
                payload_type: string;
                payload_summary: string;
              }>;
            };

            const lines = data.actions.map(
              (a) => `  [${a.payload_type}] ${a.payload_summary} (${a.hash.slice(0, 12)}…)`,
            );

            return textResult(
              `Diff: ${data.from.slice(0, 12)}… → ${data.to.slice(0, 12)}…\n` +
                `${data.action_count} action(s):\n${lines.join("\n")}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_export",
      description:
        "Export the DAG as a visual graph. " +
        "Supports Mermaid, DOT (Graphviz), and JSON formats. " +
        "Output is truncated at 256 KB to protect LLM context.",
      parameters: Type.Object({
        format: Type.Optional(
          Type.Union([Type.Literal("mermaid"), Type.Literal("dot"), Type.Literal("json")], {
            description: "Export format (default: mermaid)",
            default: "mermaid",
          }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const format = (params.format as string) ?? "mermaid";
        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/export?format=${encodeURIComponent(format)}`,
          getInit,
          "DAG export failed",
          "Cortex unavailable. DAG export failed.",
          async (res) => {
            let text = await res.text();
            let truncated = false;
            if (text.length > MAX_EXPORT_CHARS) {
              text = text.slice(0, MAX_EXPORT_CHARS);
              truncated = true;
            }

            return textResult(
              truncated
                ? `${text}\n\n[OUTPUT TRUNCATED — ${MAX_EXPORT_CHARS} char limit reached. Use the CLI \`mayros dag export\` for the full output.]`
                : text,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_stats",
      description: "Get DAG statistics: total action count and tip count.",
      parameters: Type.Object({}),
      execute: async () =>
        fetchDag(
          `${cortexBaseUrl}/api/v1/dag/stats`,
          getInit,
          "DAG stats failed",
          "Cortex unavailable. DAG stats cannot be retrieved.",
          async (res) => {
            const data = (await res.json()) as { action_count: number; tip_count: number };
            return textResult(
              `DAG Statistics:\n  Actions: ${data.action_count}\n  Tips: ${data.tip_count}`,
            );
          },
        ),
    },

    {
      name: "mayros_dag_verify",
      description:
        "Verify the Ed25519 signature of a DAG action. " +
        "Checks cryptographic integrity of a specific action.",
      parameters: Type.Object({
        hash: Type.String({ description: "DAG action hash to verify" }),
        public_key: Type.String({ description: "Ed25519 public key (hex or base64)" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const hash = encodeURIComponent(params.hash as string);
        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/verify/${hash}`,
          {
            method: "POST",
            headers: postHeaders,
            body: JSON.stringify({ public_key: params.public_key }),
          },
          "DAG verify failed",
          "Cortex unavailable. DAG verification failed.",
          async (res) => {
            const data = (await res.json()) as {
              valid: boolean;
              action_hash: string;
              detail: string;
            };

            return textResult(
              `Verification: ${data.valid ? "VALID" : "INVALID"}\n  Hash: ${data.action_hash}\n  Detail: ${data.detail}`,
            );
          },
        );
      },
    },

    {
      name: "mayros_dag_prune",
      description:
        "DESTRUCTIVE: Prune old DAG actions. This permanently removes history. " +
        "Always confirm with the user before calling. " +
        "Policies: keep_all, keep_since, keep_last, keep_depth. " +
        "Optionally creates a checkpoint before pruning.",
      parameters: Type.Object({
        policy: Type.Union(
          [
            Type.Literal("keep_all"),
            Type.Literal("keep_since"),
            Type.Literal("keep_last"),
            Type.Literal("keep_depth"),
          ],
          { description: "Prune policy" },
        ),
        value: Type.Optional(
          Type.Number({ description: "Policy value (timestamp, count, or depth)" }),
        ),
        create_checkpoint: Type.Optional(
          Type.Boolean({ description: "Create checkpoint before pruning (default: false)" }),
        ),
        confirm: Type.Boolean({
          description: "Must be true to execute. This is a destructive operation.",
        }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        if (params.confirm !== true) {
          return textResult(
            "Prune aborted: confirm must be true. This is a destructive operation — ask the user to confirm before proceeding.",
          );
        }

        return fetchDag(
          `${cortexBaseUrl}/api/v1/dag/prune`,
          {
            method: "POST",
            headers: postHeaders,
            body: JSON.stringify({
              policy: params.policy,
              value: params.value,
              create_checkpoint: params.create_checkpoint,
            }),
          },
          "DAG prune failed",
          "Cortex unavailable. DAG prune failed.",
          async (res) => {
            const data = (await res.json()) as {
              pruned_count: number;
              retained_count: number;
              checkpoint_hash: string | null;
            };

            const checkpoint = data.checkpoint_hash
              ? `\n  Checkpoint: ${data.checkpoint_hash}`
              : "";

            return textResult(
              `Prune complete:\n  Pruned: ${data.pruned_count}\n  Retained: ${data.retained_count}${checkpoint}`,
            );
          },
        );
      },
    },
  ];
}
