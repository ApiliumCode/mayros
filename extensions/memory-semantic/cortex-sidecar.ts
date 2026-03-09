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
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
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
  private stopping = false;
  private lockPath: string | null = null;
  private stderrBuffer: string[] = [];
  private static readonly MAX_RESTARTS = 3;
  private static readonly STDERR_BUFFER_SIZE = 50;

  constructor(private readonly config: CortexConfig) {
    this.client = new CortexClient(config);
  }

  get status(): SidecarStatus {
    return this._status;
  }

  /** Returns the last lines of sidecar stderr output for diagnostics. */
  getLastLogs(): string[] {
    return [...this.stderrBuffer];
  }

  /**
   * Ensure Cortex is reachable, spawning the process if needed.
   * Returns `true` when healthy, `false` on failure.
   */
  async start(): Promise<boolean> {
    this.stopping = false;

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
      // Only auto-install when the binary was auto-detected (not explicitly configured)
      if (!this.config.binaryPath) {
        console.info("[cortex] binary not found — attempting auto-install...");
        try {
          const { installOrUpdateCortex } = await import("../shared/cortex-update-check.js");
          await installOrUpdateCortex((msg) => console.info(`[cortex] ${msg}`));
          binaryPath = await locateCortexBinary();
        } catch (err) {
          console.warn(`[cortex] auto-install failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (!binaryPath || !existsSync(binaryPath)) {
        console.error(
          "[cortex] no binary available. Run: mayros update (or download from https://github.com/ApiliumCode/aingle/releases)",
        );
        this._status = "failed";
        return false;
      }
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

  /**
   * Flush Cortex data via REST before stopping the process.
   * Best-effort — if Cortex is unreachable, continues silently.
   */
  private async flushBeforeStop(): Promise<void> {
    try {
      const url = `http://${this.config.host}:${this.config.port}/api/v1/flush`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(url, { method: "POST", signal: controller.signal });
      clearTimeout(timeout);
    } catch {
      // best-effort
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;

    // Remove process signal handlers to prevent double-stop
    this.removeSignalHandlers();

    if (!this.process) {
      this._status = "stopped";
      this.releaseLock();
      this.stopping = false;
      return;
    }

    // Flush data via REST before sending SIGTERM
    await this.flushBeforeStop();

    const proc = this.process;
    this.process = null;

    // Give it a chance to shut down gracefully (SIGTERM triggers its own flush + snapshot)
    proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 10_000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this._status = "stopped";
    this.releaseLock();
    this.stopping = false;
  }

  /**
   * Gracefully restart the sidecar after a binary update.
   *
   * 1. Flush data via REST
   * 2. Stop the process (SIGTERM → Cortex flushes + saves snapshot)
   * 3. Wait for exit
   * 4. Start again with the new binary
   */
  async restartForUpdate(): Promise<boolean> {
    console.info("[cortex] restarting sidecar for binary update...");
    this.restartCount = 0;
    await this.stop();
    return this.start(); // start() resets stopping = false
  }

  private removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers.clear();
  }

  // ---------- internals ----------

  /** Resolves the data directory, creating it if necessary. */
  private resolveDataDir(): string {
    const dir = this.config.dataDir ?? join(homedir(), ".mayros", "cortex-data");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async spawn(binaryPath: string): Promise<boolean> {
    this._status = "starting";
    this.stderrBuffer = [];

    const dataDir = this.resolveDataDir();
    const dbPath = join(dataDir, "graph.sled");

    // Acquire a lock file to prevent multiple sidecars on the same dataDir
    if (!this.acquireLock(dataDir)) {
      console.error(
        `[cortex] another sidecar is using ${dataDir}. Stop it first or use a different dataDir.`,
      );
      this._status = "failed";
      return false;
    }

    // Check if the port is already in use by something other than Cortex
    if (!(await this.ensurePortAvailable())) {
      this.releaseLock();
      // If ensurePortAvailable detected an external Cortex, status is "running" — don't overwrite
      if (this._status !== "running") {
        this._status = "failed";
      }
      return this._status === "running";
    }

    const args = ["--host", this.config.host, "--port", String(this.config.port), "--db", dbPath];

    // P2P flag forwarding (B1): map CortexConfig.p2p to CLI flags
    if (this.config.p2p?.enabled) {
      args.push("--p2p");
      args.push("--p2p-port", String(this.config.p2p.port ?? 19091));
      if (this.config.p2p.seed) args.push("--p2p-seed", this.config.p2p.seed);
      if (this.config.p2p.mdns) args.push("--p2p-mdns");
      for (const peer of this.config.p2p.manualPeers ?? []) {
        args.push("--p2p-peer", peer);
      }
    }

    const secrets = ensureCortexSecrets(this.config.dataDir);

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
      this.releaseLock();
      return false;
    }

    // Drain stdout to prevent child process blocking on full pipe buffers
    this.process.stdout?.resume();

    // Capture stderr for diagnostics (ring buffer of last N lines)
    this.process.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this.stderrBuffer.push(line);
        if (this.stderrBuffer.length > CortexSidecar.STDERR_BUFFER_SIZE) {
          this.stderrBuffer.shift();
        }
      }
    });

    // Handle unexpected exit — auto-restart only if not deliberately stopping
    this.process.once("exit", (code) => {
      if (this._status === "running" || this._status === "starting") {
        this._status = code === 0 ? "stopped" : "failed";
      }
      this.process = null;
      this.removeSignalHandlers();

      // Skip auto-restart if this was a deliberate stop/update
      if (this.stopping) return;

      // Auto-restart on unexpected crash (up to MAX_RESTARTS attempts)
      if (this._status === "failed" && this.restartCount < CortexSidecar.MAX_RESTARTS) {
        this.restartCount += 1;
        const attempt = this.restartCount;
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        console.warn(
          `[cortex] sidecar crashed, restart attempt ${attempt}/${CortexSidecar.MAX_RESTARTS} in ${delayMs}ms...`,
        );
        if (this.stderrBuffer.length > 0) {
          console.warn(`[cortex] last stderr: ${this.stderrBuffer.slice(-3).join(" | ")}`);
        }
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

  /**
   * Check if the configured port is available. If something is already listening
   * and it's Cortex (healthy), treat as external instance. Otherwise fail.
   */
  private async ensurePortAvailable(): Promise<boolean> {
    const portInUse = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: this.config.host, port: this.config.port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (!portInUse) return true; // port is free

    // Something is listening — check if it's Cortex
    if (await this.client.isHealthy()) {
      this._status = "running";
      console.info(`[cortex] external Cortex already running on port ${this.config.port}`);
      return false; // don't spawn, but not a failure — caller checks status
    }

    console.error(
      `[cortex] port ${this.config.port} is in use by another process. Change cortex.port in config.`,
    );
    return false;
  }

  /**
   * Acquire a lock file in the data directory. Returns true on success.
   * Reclaims stale locks from dead processes automatically.
   */
  private acquireLock(dataDir: string): boolean {
    const lockFile = join(dataDir, ".cortex.lock");
    try {
      // Exclusive create — fails if file already exists
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      this.lockPath = lockFile;
      return true;
    } catch (createErr: unknown) {
      // Check if the failure is a permission issue (not a lock conflict)
      const code = (createErr as { code?: string })?.code;
      if (code && code !== "EEXIST") {
        console.error(`[cortex] cannot create lock file in ${dataDir}: ${code}`);
        return false;
      }
      // File exists — check if the PID is still alive
      try {
        const existingPid = Number(readFileSync(lockFile, "utf-8").trim());
        if (existingPid && !isNaN(existingPid)) {
          try {
            process.kill(existingPid, 0); // probe — throws if process is dead
            return false; // process is alive, lock is valid
          } catch {
            console.info(`[cortex] reclaiming stale lock from dead process ${existingPid}`);
          }
        }
        unlinkSync(lockFile);
        writeFileSync(lockFile, String(process.pid), { flag: "wx" });
        this.lockPath = lockFile;
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Release the lock file. */
  private releaseLock(): void {
    if (this.lockPath) {
      try {
        unlinkSync(this.lockPath);
      } catch {
        // best-effort
      }
      this.lockPath = null;
    }
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

const DEFAULT_SECRETS_DIR = join(homedir(), ".mayros");

function resolveSecretsPath(dataDir?: string): string {
  const dir = dataDir ?? DEFAULT_SECRETS_DIR;
  return join(dir, SECRETS_FILENAME);
}

export function ensureCortexSecrets(dataDir?: string): CortexSecrets {
  // Env vars take precedence over persisted file
  const envJwt = process.env.AINGLE_JWT_SECRET?.trim();
  const envAdmin = process.env.AINGLE_ADMIN_PASSWORD?.trim();

  if (envJwt && envAdmin) {
    return { jwtSecret: envJwt, adminPassword: envAdmin };
  }

  // Try to load from the target directory
  const secretsPath = resolveSecretsPath(dataDir);
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

  // Migrate from default location if dataDir is set and secrets only exist in ~/.mayros
  if (dataDir && !persisted.jwtSecret) {
    const defaultPath = resolveSecretsPath();
    if (existsSync(defaultPath)) {
      try {
        const raw = readFileSync(defaultPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.jwtSecret === "string") persisted.jwtSecret = parsed.jwtSecret;
        if (typeof parsed.adminPassword === "string")
          persisted.adminPassword = parsed.adminPassword;
      } catch {
        // corrupted — regenerate
      }
    }
  }

  const jwtSecret = envJwt || persisted.jwtSecret || randomBytes(48).toString("base64");
  const adminPassword = envAdmin || persisted.adminPassword || generatePassword(20);

  // Persist if we generated anything new
  if (jwtSecret !== persisted.jwtSecret || adminPassword !== persisted.adminPassword) {
    try {
      const dir = dataDir ?? DEFAULT_SECRETS_DIR;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        resolveSecretsPath(dataDir),
        JSON.stringify({ jwtSecret, adminPassword }, null, 2),
        {
          mode: 0o600,
        },
      );
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
