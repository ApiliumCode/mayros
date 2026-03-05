/**
 * Code Indexer configuration schema.
 *
 * Controls which paths to scan, ignore patterns, limits, and
 * incremental indexing behavior.
 */

import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

export type CodeIndexerConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  paths: string[];
  ignore: string[];
  maxFiles: number;
  extensions: string[];
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_PATHS = ["src", "extensions"];
const DEFAULT_IGNORE = [
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".next",
  ".turbo",
  "*.test.ts",
  "*.spec.ts",
];
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

export const codeIndexerConfigSchema = {
  parse(value: unknown): CodeIndexerConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("code-indexer config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["cortex", "agentNamespace", "paths", "ignore", "maxFiles", "extensions"],
      "code-indexer config",
    );

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const paths = Array.isArray(cfg.paths)
      ? (cfg.paths as unknown[]).filter((p): p is string => typeof p === "string")
      : DEFAULT_PATHS;

    const ignore = Array.isArray(cfg.ignore)
      ? (cfg.ignore as unknown[]).filter((p): p is string => typeof p === "string")
      : DEFAULT_IGNORE;

    const maxFiles =
      typeof cfg.maxFiles === "number" && cfg.maxFiles > 0 && cfg.maxFiles <= 50000
        ? cfg.maxFiles
        : DEFAULT_MAX_FILES;

    const extensions = Array.isArray(cfg.extensions)
      ? (cfg.extensions as unknown[]).filter((p): p is string => typeof p === "string")
      : DEFAULT_EXTENSIONS;

    return { cortex, agentNamespace, paths, ignore, maxFiles, extensions };
  },
  uiHints: {
    "cortex.host": {
      label: "Cortex Host",
      placeholder: "127.0.0.1",
      advanced: true,
      help: "Hostname where AIngle Cortex is listening",
    },
    "cortex.port": {
      label: "Cortex Port",
      placeholder: "8080",
      advanced: true,
      help: "Port for Cortex REST API",
    },
    agentNamespace: {
      label: "Agent Namespace",
      placeholder: DEFAULT_NAMESPACE,
      advanced: true,
      help: "RDF namespace prefix for code index data",
    },
    paths: {
      label: "Scan Paths",
      help: "Directories to scan for code files (relative to project root)",
    },
    ignore: {
      label: "Ignore Patterns",
      help: "Directory/file patterns to exclude from indexing",
    },
    maxFiles: {
      label: "Max Files",
      help: "Maximum number of files to index (default: 5000)",
    },
  },
};
