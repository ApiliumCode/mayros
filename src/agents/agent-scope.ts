import path from "node:path";
import type { MayrosConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { discoverMarkdownAgents, type MarkdownAgent } from "./markdown-agents.js";
import { normalizeSkillFilter } from "./skills/filter.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

export { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

type AgentEntry = NonNullable<NonNullable<MayrosConfig["agents"]>["list"]>[number];

type ResolvedAgentConfig = {
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentEntry["model"];
  skills?: AgentEntry["skills"];
  memorySearch?: AgentEntry["memorySearch"];
  humanDelay?: AgentEntry["humanDelay"];
  heartbeat?: AgentEntry["heartbeat"];
  identity?: AgentEntry["identity"];
  groupChat?: AgentEntry["groupChat"];
  subagents?: AgentEntry["subagents"];
  sandbox?: AgentEntry["sandbox"];
  tools?: AgentEntry["tools"];
};

let defaultAgentWarned = false;

export function listAgentEntries(cfg: MayrosConfig): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
}

/**
 * Convert a MarkdownAgent to an AgentEntry for use in the config system.
 */
function markdownAgentToEntry(md: MarkdownAgent): AgentEntry {
  return {
    id: md.id,
    name: md.name,
    default: md.isDefault || undefined,
    model: md.model,
    workspace: md.workspace,
  };
}

/**
 * List all agent entries including those discovered from .mayros/agents/.
 * Config agents take priority over markdown agents with the same id.
 */
export function listAllAgentEntries(cfg: MayrosConfig): AgentEntry[] {
  const configEntries = listAgentEntries(cfg);
  const configIds = new Set(configEntries.map((e) => normalizeAgentId(e.id)));

  const mdAgents = discoverMarkdownAgents();
  const mdEntries = mdAgents.filter((md) => !configIds.has(md.id)).map(markdownAgentToEntry);

  return [...configEntries, ...mdEntries];
}

export function listAgentIds(cfg: MayrosConfig): string[] {
  const agents = listAllAgentEntries(cfg);
  if (agents.length === 0) {
    return [DEFAULT_AGENT_ID];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of agents) {
    const id = normalizeAgentId(entry?.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}

export function resolveDefaultAgentId(cfg: MayrosConfig): string {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((agent) => agent?.default);
  if (defaults.length > 1 && !defaultAgentWarned) {
    defaultAgentWarned = true;
    console.warn("Multiple agents marked default=true; using the first entry as default.");
  }
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return normalizeAgentId(chosen || DEFAULT_AGENT_ID);
}

export function resolveSessionAgentIds(params: { sessionKey?: string; config?: MayrosConfig }): {
  defaultAgentId: string;
  sessionAgentId: string;
} {
  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  const sessionKey = params.sessionKey?.trim();
  const normalizedSessionKey = sessionKey ? sessionKey.toLowerCase() : undefined;
  const parsed = normalizedSessionKey ? parseAgentSessionKey(normalizedSessionKey) : null;
  const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
  return { defaultAgentId, sessionAgentId };
}

export function resolveSessionAgentId(params: {
  sessionKey?: string;
  config?: MayrosConfig;
}): string {
  return resolveSessionAgentIds(params).sessionAgentId;
}

function resolveAgentEntry(cfg: MayrosConfig, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  // Config agents take priority
  const configEntry = listAgentEntries(cfg).find((entry) => normalizeAgentId(entry.id) === id);
  if (configEntry) {
    return configEntry;
  }
  // Fall back to markdown agents
  const mdAgent = discoverMarkdownAgents().find((md) => md.id === id);
  if (mdAgent) {
    return markdownAgentToEntry(mdAgent);
  }
  return undefined;
}

export function resolveAgentConfig(
  cfg: MayrosConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) {
    return undefined;
  }
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    skills: Array.isArray(entry.skills) ? entry.skills : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
  };
}

export function resolveAgentSkillsFilter(cfg: MayrosConfig, agentId: string): string[] | undefined {
  return normalizeSkillFilter(resolveAgentConfig(cfg, agentId)?.skills);
}

export function resolveAgentModelPrimary(cfg: MayrosConfig, agentId: string): string | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  const primary = raw.primary?.trim();
  return primary || undefined;
}

export function resolveAgentModelFallbacksOverride(
  cfg: MayrosConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw || typeof raw === "string") {
    return undefined;
  }
  // Important: treat an explicitly provided empty array as an override to disable global fallbacks.
  if (!Object.hasOwn(raw, "fallbacks")) {
    return undefined;
  }
  return Array.isArray(raw.fallbacks) ? raw.fallbacks : undefined;
}

export function resolveEffectiveModelFallbacks(params: {
  cfg: MayrosConfig;
  agentId: string;
  hasSessionModelOverride: boolean;
}): string[] | undefined {
  const agentFallbacksOverride = resolveAgentModelFallbacksOverride(params.cfg, params.agentId);
  if (!params.hasSessionModelOverride) {
    return agentFallbacksOverride;
  }
  const defaultFallbacks =
    typeof params.cfg.agents?.defaults?.model === "object"
      ? (params.cfg.agents.defaults.model.fallbacks ?? [])
      : [];
  return agentFallbacksOverride ?? defaultFallbacks;
}

export function resolveAgentWorkspaceDir(cfg: MayrosConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (id === defaultAgentId) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    if (fallback) {
      return resolveUserPath(fallback);
    }
    return resolveDefaultAgentWorkspaceDir(process.env);
  }
  const stateDir = resolveStateDir(process.env);
  return path.join(stateDir, `workspace-${id}`);
}

export function resolveAgentDir(cfg: MayrosConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const root = resolveStateDir(process.env);
  return path.join(root, "agents", id, "agent");
}
