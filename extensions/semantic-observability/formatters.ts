/**
 * ObservabilityFormatter — output formatters for terminal, JSON, and markdown.
 *
 * Provides static methods to render AgentStats, TraceEvent arrays, and
 * CausalChain objects in multiple output formats.
 */

import type { CausalChain } from "./decision-graph.js";
import type { AgentStats } from "./query-engine.js";
import type { TraceEvent } from "./trace-emitter.js";

// ============================================================================
// ObservabilityFormatter
// ============================================================================

export class ObservabilityFormatter {
  /**
   * Format agent stats for terminal display.
   */
  static formatStatsTerminal(stats: AgentStats): string {
    const lines: string[] = [
      `Agent: ${stats.agentId}`,
      `Total Events: ${stats.totalEvents}`,
      `  Tool Calls:   ${stats.toolCalls}  (avg ${stats.avgToolDurationMs}ms)`,
      `  LLM Calls:    ${stats.llmCalls}  (avg ${stats.avgLLMDurationMs}ms)`,
      `  Decisions:    ${stats.decisions}`,
      `  Delegations:  ${stats.delegations}`,
      `  Errors:       ${stats.errors}`,
    ];
    return lines.join("\n");
  }

  /**
   * Format trace events for terminal display.
   */
  static formatEventsTerminal(events: TraceEvent[]): string {
    if (events.length === 0) {
      return "No events found.";
    }

    const lines: string[] = [];
    for (const evt of events) {
      const ts = evt.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
      const duration = evt.durationMs !== undefined ? ` (${evt.durationMs}ms)` : "";
      let detail = "";

      switch (evt.type) {
        case "tool_call":
          detail = evt.fields.toolName ?? "";
          break;
        case "llm_call":
          detail = `${evt.fields.model ?? "?"} ${evt.fields.totalTokens ?? "?"}tok`;
          break;
        case "decision":
          detail = evt.fields.description ?? "";
          break;
        case "delegation":
          detail = `${evt.fields.parentId ?? "?"} -> ${evt.fields.childId ?? "?"}`;
          break;
        case "error":
          detail = evt.fields.error ?? "";
          break;
      }

      lines.push(`[${ts}] ${evt.type.padEnd(12)} ${detail}${duration}  (${evt.id.slice(0, 8)})`);
    }

    return lines.join("\n");
  }

  /**
   * Format a causal chain for terminal display.
   */
  static formatCausalChainTerminal(chain: CausalChain): string {
    if (chain.chain.length === 0) {
      return "No causal chain found.";
    }

    const lines: string[] = ["Causal Chain:", ""];
    for (let i = 0; i < chain.chain.length; i++) {
      const link = chain.chain[i];
      const indent = "  ".repeat(i);
      const arrow = i > 0 ? "-> " : "   ";
      const ts = link.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
      lines.push(`${indent}${arrow}[${ts}] ${link.summary}  (${link.eventId.slice(0, 8)})`);
    }

    return lines.join("\n");
  }

  /**
   * Format agent stats as JSON string.
   */
  static formatStatsJSON(stats: AgentStats): string {
    return JSON.stringify(stats, null, 2);
  }

  /**
   * Format trace events as markdown table.
   */
  static formatEventsMarkdown(events: TraceEvent[]): string {
    if (events.length === 0) {
      return "No events found.";
    }

    const lines: string[] = [
      "| Timestamp | Type | Agent | Detail | Duration |",
      "|-----------|------|-------|--------|----------|",
    ];

    for (const evt of events) {
      const ts = evt.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
      const duration = evt.durationMs !== undefined ? `${evt.durationMs}ms` : "-";
      let detail = "";

      switch (evt.type) {
        case "tool_call":
          detail = evt.fields.toolName ?? "";
          break;
        case "llm_call":
          detail = `${evt.fields.model ?? "?"} (${evt.fields.totalTokens ?? "?"}tok)`;
          break;
        case "decision":
          detail = evt.fields.description ?? "";
          break;
        case "delegation":
          detail = `${evt.fields.parentId ?? "?"} -> ${evt.fields.childId ?? "?"}`;
          break;
        case "error":
          detail = evt.fields.error ?? "";
          break;
      }

      // Escape pipes in detail
      detail = detail.replace(/\|/g, "\\|");

      lines.push(`| ${ts} | ${evt.type} | ${evt.agentId} | ${detail} | ${duration} |`);
    }

    return lines.join("\n");
  }
}
