/**
 * TrustedFolderStore — Manage trusted folder list for project config gating.
 *
 * Storage: ~/.mayros/trusted-folders.json
 * Atomic writes with temp file + rename.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";

export type TrustLevel = "full" | "read-only" | "ask";

export type TrustedFolder = {
  path: string;
  trustedAt: string;
  trustLevel: TrustLevel;
};

export type TrustedFoldersFile = {
  version: 1;
  trustedFolders: TrustedFolder[];
};

export type TrustCheckResult = {
  trusted: boolean;
  level: TrustLevel | null;
  path: string;
};

const TRUSTED_FOLDERS_FILENAME = "trusted-folders.json";

/**
 * Resolve the path to the trusted folders file.
 */
export function resolveTrustedFoldersPath(env?: Record<string, string | undefined>): string {
  const homeDir = resolveRequiredHomeDir(env);
  return join(homeDir, ".mayros", TRUSTED_FOLDERS_FILENAME);
}

export class TrustedFolderStore {
  private filePath: string;
  private folders: TrustedFolder[] = [];
  private loaded = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? resolveTrustedFoldersPath();
  }

  /**
   * Load trusted folders from disk.
   */
  load(): void {
    this.folders = [];
    this.loaded = true;

    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<TrustedFoldersFile>;
      if (parsed.version !== 1) return;
      if (!Array.isArray(parsed.trustedFolders)) return;

      this.folders = parsed.trustedFolders.filter(
        (f): f is TrustedFolder =>
          typeof f === "object" &&
          f !== null &&
          typeof f.path === "string" &&
          typeof f.trustedAt === "string" &&
          typeof f.trustLevel === "string" &&
          ["full", "read-only", "ask"].includes(f.trustLevel),
      );
    } catch {
      this.folders = [];
    }
  }

  /**
   * Check if a folder is trusted.
   */
  checkTrust(folderPath: string): TrustCheckResult {
    if (!this.loaded) this.load();

    const normalized = resolve(folderPath);

    // Exact match first
    const exact = this.folders.find((f) => resolve(f.path) === normalized);
    if (exact) {
      return { trusted: true, level: exact.trustLevel, path: normalized };
    }

    // Parent match — if a parent folder is trusted, children inherit
    for (const f of this.folders) {
      const trustedPath = resolve(f.path);
      if (normalized.startsWith(trustedPath + "/") || normalized === trustedPath) {
        return { trusted: true, level: f.trustLevel, path: normalized };
      }
    }

    return { trusted: false, level: null, path: normalized };
  }

  /**
   * Trust a folder with the given level.
   */
  trust(folderPath: string, level: TrustLevel): void {
    if (!this.loaded) this.load();

    const normalized = resolve(folderPath);

    // Remove existing entry if present
    this.folders = this.folders.filter((f) => resolve(f.path) !== normalized);

    this.folders.push({
      path: normalized,
      trustedAt: new Date().toISOString(),
      trustLevel: level,
    });

    this.save();
  }

  /**
   * Remove trust from a folder.
   */
  untrust(folderPath: string): boolean {
    if (!this.loaded) this.load();

    const normalized = resolve(folderPath);
    const before = this.folders.length;
    this.folders = this.folders.filter((f) => resolve(f.path) !== normalized);

    if (this.folders.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * List all trusted folders.
   */
  listTrusted(): TrustedFolder[] {
    if (!this.loaded) this.load();
    return [...this.folders];
  }

  /**
   * Check what config operations are allowed for a trust level.
   */
  static getAllowedOperations(level: TrustLevel | null): {
    loadProjectConfig: boolean;
    loadProjectCommands: boolean;
    loadProjectAgents: boolean;
    allowHooks: boolean;
    allowShellTools: boolean;
  } {
    switch (level) {
      case "full":
        return {
          loadProjectConfig: true,
          loadProjectCommands: true,
          loadProjectAgents: true,
          allowHooks: true,
          allowShellTools: true,
        };
      case "read-only":
        return {
          loadProjectConfig: true,
          loadProjectCommands: true,
          loadProjectAgents: true,
          allowHooks: false,
          allowShellTools: false,
        };
      case "ask":
      case null:
        return {
          loadProjectConfig: false,
          loadProjectCommands: false,
          loadProjectAgents: false,
          allowHooks: false,
          allowShellTools: false,
        };
    }
  }

  /**
   * Persist trusted folders to disk with atomic write.
   */
  private save(): void {
    const data: TrustedFoldersFile = {
      version: 1,
      trustedFolders: this.folders,
    };

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = this.filePath + `.tmp.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, this.filePath);
  }
}
