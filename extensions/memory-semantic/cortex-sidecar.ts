/**
 * Manages the AIngle Cortex sidecar process lifecycle.
 *
 * - Spawn `aingle-cortex` if autoStart is true and binaryPath is set
 * - Poll /health with exponential backoff (max 10 s)
 * - Skip spawn when Cortex is already reachable on the configured port
 * - Auto-generate and persist AINGLE_JWT_SECRET / AINGLE_ADMIN_PASSWORD
 * - Graceful shutdown via SIGTERM
 */

import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { locateCortexBinary, getCortexBinaryVersion } from "../shared/cortex-binary-locator.js";
import { REQUIRED_CORTEX_VERSION } from "../shared/cortex-version.js";
import type { CortexConfig } from "./config.js";
import { CortexClient } from "./cortex-client.js";

export type SidecarStatus = "stopped" | "starting" | "running" | "failed";

export class CortexSidecar {
  private process: ChildProcess | null = null;
  private _status: SidecarStatus = "stopped";
  private readonly client: CortexClient;
  private signalHandlers = new Map<string, () => void>();
  private restartCount = 0;
  private static readonly MAX_RESTARTS = 3;

  constructor(private readonly config: CortexConfig) {
    this.client = new CortexClient(config);
  }

  get status(): SidecarStatus {
    return this._status;
  }

  /**
   * Ensure Cortex is reachable, spawning the process if needed.
   * Returns `true` when healthy, `false` on failure.
   */
  async start(): Promise<boolean> {
    // Already running externally?
    if (await this.client.isHealthy()) {
      this._status = "running";
      return true;
    }

    if (!this.config.autoStart) {
      this._status = "stopped";
      return false;
    }

    // Auto-detect binary if not explicitly configured
    let binaryPath = this.config.binaryPath;
    if (!binaryPath) {
      binaryPath = await locateCortexBinary();
    }

    if (!binaryPath || !existsSync(binaryPath)) {
      this._status = "failed";
      return false;
    }

    // Warn (but don't block) if the installed binary is older than required
    const installedVersion = getCortexBinaryVersion(binaryPath);
    if (installedVersion && REQUIRED_CORTEX_VERSION) {
      const [iMaj, iMin, iPat] = installedVersion.split(".").map(Number);
      const [rMaj, rMin, rPat] = REQUIRED_CORTEX_VERSION.split(".").map(Number);
      if (
        iMaj < rMaj ||
        (iMaj === rMaj && iMin < rMin) ||
        (iMaj === rMaj && iMin === rMin && iPat < rPat)
      ) {
        console.warn(
          `[cortex] binary outdated (${installedVersion} < ${REQUIRED_CORTEX_VERSION}). Run: mayros update`,
        );
      }
    } else if (!installedVersion) {
      console.warn(`[cortex] could not determine binary version. Run: mayros update`);
    }

    // Strict version enforcement: block outdated binary when enabled
    if (this.config.strictVersionCheck && installedVersion && REQUIRED_CORTEX_VERSION) {
      const [iMaj, iMin, iPat] = installedVersion.split(".").map(Number);
      const [rMaj, rMin, rPat] = REQUIRED_CORTEX_VERSION.split(".").map(Number);
      const isOutdated =
        iMaj < rMaj ||
        (iMaj === rMaj && iMin < rMin) ||
        (iMaj === rMaj && iMin === rMin && iPat < rPat);
      if (isOutdated) {
        console.error(
          `[cortex] strict version check failed: ${installedVersion} < ${REQUIRED_CORTEX_VERSION}. Update required.`,
        );
        this._status = "failed";
        return false;
      }
    }

    return this.spawn(binaryPath);
  }

  async stop(): Promise<void> {
    // Remove process signal handlers to prevent double-stop
    this.removeSignalHandlers();

    if (!this.process) {
      this._status = "stopped";
      return;
    }

    const proc = this.process;
    this.process = null;

    // Give it a chance to shut down gracefully
    proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this._status = "stopped";
  }

  private removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers.clear();
  }

  // ---------- internals ----------

  private async spawn(binaryPath: string): Promise<boolean> {
    this._status = "starting";

    const args = ["--host", this.config.host, "--port", String(this.config.port)];
    const secrets = ensureCortexSecrets();

    try {
      this.process = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        env: {
          ...process.env,
          AINGLE_JWT_SECRET: secrets.jwtSecret,
          AINGLE_ADMIN_PASSWORD: secrets.adminPassword,
        },
      });
    } catch {
      this._status = "failed";
      return false;
    }

    // Drain stdout/stderr to prevent child process blocking on full pipe buffers
    this.process.stdout?.resume();
    this.process.stderr?.resume();

    // Handle unexpected exit with one auto-restart attempt
    this.process.once("exit", (code) => {
      if (this._status === "running" || this._status === "starting") {
        this._status = code === 0 ? "stopped" : "failed";
      }
      this.process = null;
      this.removeSignalHandlers();

      // Auto-restart on unexpected crash (up to MAX_RESTARTS attempts)
      if (this._status === "failed" && this.restartCount < CortexSidecar.MAX_RESTARTS) {
        this.restartCount += 1;
        const attempt = this.restartCount;
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        console.warn(
          `[cortex] sidecar crashed, restart attempt ${attempt}/${CortexSidecar.MAX_RESTARTS} in ${delayMs}ms...`,
        );
        setTimeout(() => {
          void this.spawn(binaryPath).then((ok) => {
            if (ok) {
              console.info(`[cortex] sidecar restarted successfully (attempt ${attempt})`);
            } else {
              console.error(`[cortex] sidecar restart failed (attempt ${attempt})`);
            }
          });
        }, delayMs);
      }
    });

    // Handle spawn errors
    this.process.once("error", () => {
      this._status = "failed";
      this.process = null;
    });

    // Wait for health with exponential backoff
    const healthy = await this.waitForHealthy();
    if (healthy) {
      this._status = "running";
      this.restartCount = 0; // reset for future crashes

      // Register process signal handlers for graceful sidecar shutdown
      const cleanup = () => {
        void this.stop();
      };
      for (const signal of ["SIGTERM", "SIGINT", "beforeExit"] as const) {
        process.once(signal, cleanup);
        this.signalHandlers.set(signal, cleanup);
      }
    } else {
      this._status = "failed";
      await this.stop();
    }
    return healthy;
  }

  private async waitForHealthy(): Promise<boolean> {
    const maxWaitMs = 10_000;
    const start = Date.now();
    let delay = 100;

    while (Date.now() - start < maxWaitMs) {
      if (await this.client.isHealthy()) {
        return true;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 2000);
    }

    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cortex secrets (AINGLE_JWT_SECRET + AINGLE_ADMIN_PASSWORD)
//
// Since Cortex 0.3.7, both env vars are required at startup.
// We auto-generate and persist them in ~/.mayros/cortex-secrets.json
// so they survive restarts and are not regenerated each time.
// If the env vars are already set externally, those values take precedence.
// ---------------------------------------------------------------------------

type CortexSecrets = { jwtSecret: string; adminPassword: string };

const SECRETS_FILENAME = "cortex-secrets.json";

function resolveSecretsPath(): string {
  const stateDir = join(homedir(), ".mayros");
  return join(stateDir, SECRETS_FILENAME);
}

export function ensureCortexSecrets(): CortexSecrets {
  // Env vars take precedence over persisted file
  const envJwt = process.env.AINGLE_JWT_SECRET?.trim();
  const envAdmin = process.env.AINGLE_ADMIN_PASSWORD?.trim();

  if (envJwt && envAdmin) {
    return { jwtSecret: envJwt, adminPassword: envAdmin };
  }

  // Try to load from persisted file
  const secretsPath = resolveSecretsPath();
  let persisted: Partial<CortexSecrets> = {};

  if (existsSync(secretsPath)) {
    try {
      const raw = readFileSync(secretsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.jwtSecret === "string") persisted.jwtSecret = parsed.jwtSecret;
      if (typeof parsed.adminPassword === "string") persisted.adminPassword = parsed.adminPassword;
    } catch {
      // corrupted file — will regenerate
    }
  }

  const jwtSecret = envJwt || persisted.jwtSecret || randomBytes(48).toString("base64");
  const adminPassword = envAdmin || persisted.adminPassword || generatePassword(20);

  // Persist if we generated anything new
  if (jwtSecret !== persisted.jwtSecret || adminPassword !== persisted.adminPassword) {
    try {
      mkdirSync(join(homedir(), ".mayros"), { recursive: true });
      writeFileSync(secretsPath, JSON.stringify({ jwtSecret, adminPassword }, null, 2), {
        mode: 0o600,
      });
    } catch {
      // Non-fatal: secrets work for this session even if persistence fails
    }
  }

  return { jwtSecret, adminPassword };
}

function generatePassword(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
