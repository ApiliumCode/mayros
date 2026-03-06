/**
 * Session Summary Service
 *
 * Auto-generates a summary of a conversation session by analysing
 * messages, tool calls, topics, and duration.
 */

// ============================================================================
// Types
// ============================================================================

export type SessionSummaryInput = {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  toolCalls?: Array<{ name: string; args?: string }>;
  sessionKey: string;
  startedAt: number;
  endedAt?: number;
};

export type SessionSummary = {
  title: string;
  description: string;
  toolsUsed: string[];
  messageCount: number;
  durationMs: number;
  topics: string[];
};

// ============================================================================
// Topic extraction vocabulary
// ============================================================================

const LANGUAGE_KEYWORDS = new Set([
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c++",
  "ruby",
  "swift",
  "kotlin",
  "php",
  "html",
  "css",
  "sql",
  "bash",
  "shell",
  "yaml",
  "json",
  "markdown",
  "graphql",
  "elixir",
  "scala",
  "dart",
  "lua",
]);

const FRAMEWORK_KEYWORDS = new Set([
  "react",
  "vue",
  "angular",
  "next",
  "nextjs",
  "nuxt",
  "svelte",
  "express",
  "fastify",
  "nest",
  "nestjs",
  "django",
  "flask",
  "rails",
  "spring",
  "tailwind",
  "vite",
  "webpack",
  "vitest",
  "jest",
  "playwright",
  "cypress",
  "docker",
  "kubernetes",
  "terraform",
  "redis",
  "postgres",
  "mongodb",
  "prisma",
  "drizzle",
  "node",
  "deno",
  "bun",
]);

const ACTION_VERBS = new Set([
  "fix",
  "add",
  "refactor",
  "update",
  "remove",
  "delete",
  "create",
  "implement",
  "migrate",
  "debug",
  "test",
  "deploy",
  "configure",
  "optimize",
  "upgrade",
  "install",
  "build",
  "review",
  "merge",
]);

// ============================================================================
// Exported functions
// ============================================================================

/**
 * Extract up to 5 topics from the user messages in a conversation.
 *
 * Looks for programming languages, frameworks, action verbs, and
 * file-name references (e.g. `.ts`, `.json`).
 */
export function extractTopics(messages: Array<{ role: string; content: string }>): string[] {
  const counts = new Map<string, number>();

  const bump = (topic: string): void => {
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  };

  for (const msg of messages) {
    if (msg.role !== "user") continue;

    const words = msg.content.toLowerCase().split(/[\s,;:!?()[\]{}'"]+/);

    for (const word of words) {
      const clean = word.replace(/[^a-z0-9+#./-]/g, "");
      if (clean.length === 0) continue;

      if (LANGUAGE_KEYWORDS.has(clean)) {
        bump(clean);
      } else if (FRAMEWORK_KEYWORDS.has(clean)) {
        bump(clean);
      } else if (ACTION_VERBS.has(clean)) {
        bump(clean);
      }
    }

    // File-name references (e.g. "index.ts", "package.json").
    const fileRefs = msg.content.match(/[\w./-]+\.\w{1,5}/g);
    if (fileRefs) {
      for (const ref of fileRefs) {
        const ext = ref.split(".").pop()?.toLowerCase();
        if (
          ext &&
          (ext === "ts" ||
            ext === "js" ||
            ext === "json" ||
            ext === "py" ||
            ext === "rs" ||
            ext === "go")
        ) {
          bump(ext);
        }
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

/**
 * Generate a short title (< 60 chars) for a session.
 *
 * Uses the first user message content. If it starts with an action verb,
 * keep it as-is (truncated). Otherwise, prefix with the most common verb.
 */
export function generateTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Empty session";

  const raw = firstUser.content.replace(/\s+/g, " ").trim();
  const firstWord = raw.split(" ")[0]?.toLowerCase() ?? "";

  // If the message already starts with an action verb, use it directly.
  if (ACTION_VERBS.has(firstWord)) {
    return raw.length <= 60 ? raw : raw.slice(0, 57) + "...";
  }

  // Otherwise, try to find the most common verb in all user messages.
  const verbCounts = new Map<string, number>();
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    for (const word of msg.content.toLowerCase().split(/\s+/)) {
      if (ACTION_VERBS.has(word)) {
        verbCounts.set(word, (verbCounts.get(word) ?? 0) + 1);
      }
    }
  }

  let topVerb = "";
  let topCount = 0;
  for (const [verb, count] of verbCounts) {
    if (count > topCount) {
      topVerb = verb;
      topCount = count;
    }
  }

  const prefix = topVerb ? topVerb.charAt(0).toUpperCase() + topVerb.slice(1) + ": " : "";

  const combined = prefix + raw;
  return combined.length <= 60 ? combined : combined.slice(0, 57) + "...";
}

/**
 * Generate a full session summary from the given input.
 */
export function generateSessionSummary(input: SessionSummaryInput): SessionSummary {
  const { messages, toolCalls, startedAt, endedAt } = input;

  const messageCount = messages.length;
  const durationMs = (endedAt ?? Date.now()) - startedAt;

  const toolsUsed = toolCalls ? [...new Set(toolCalls.map((tc) => tc.name))] : [];

  const topics = extractTopics(messages);
  const title = generateTitle(messages);

  // Build a 1-3 sentence description.
  const userMsgCount = messages.filter((m) => m.role === "user").length;
  const assistantMsgCount = messages.filter((m) => m.role === "assistant").length;

  const parts: string[] = [];
  parts.push(
    `Session with ${userMsgCount} user message${userMsgCount !== 1 ? "s" : ""} and ${assistantMsgCount} assistant response${assistantMsgCount !== 1 ? "s" : ""}.`,
  );

  if (toolsUsed.length > 0) {
    parts.push(
      `Used ${toolsUsed.length} tool${toolsUsed.length !== 1 ? "s" : ""}: ${toolsUsed.join(", ")}.`,
    );
  }

  if (topics.length > 0) {
    parts.push(`Topics: ${topics.join(", ")}.`);
  }

  return {
    title,
    description: parts.join(" "),
    toolsUsed,
    messageCount,
    durationMs,
    topics,
  };
}
