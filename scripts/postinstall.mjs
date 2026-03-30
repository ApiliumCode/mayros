#!/usr/bin/env node
/**
 * postinstall — Download & install AIngle Cortex binary.
 *
 * Runs automatically after `npm install -g @apilium/mayros`.
 * Self-contained: uses only Node built-ins (no project imports).
 * Best-effort: failures print a warning but never break the install.
 */

import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  chmodSync,
  unlinkSync,
  renameSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "ApiliumCode/aingle";
const INSTALL_DIR = join(homedir(), ".mayros", "bin");
const IS_WIN = platform() === "win32";
const BINARY_NAME = IS_WIN ? "aingle-cortex.exe" : "aingle-cortex";
const REQUIRED_VERSION = "0.6.3";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || attempt === retries) return res;
      // Retry on 5xx or rate limit
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
}

function getPlatformAsset() {
  const osMap = { linux: "linux", darwin: "macos", win32: "windows" };
  const archMap = { x64: "x86_64", arm64: "aarch64" };
  const osKey = osMap[platform()];
  const archKey = archMap[arch()];
  if (!osKey || !archKey) return null;
  const ext = IS_WIN ? ".exe.zip" : ".tar.gz";
  return `aingle-cortex-${osKey}-${archKey}${ext}`;
}

async function main() {
  // Skip in CI or if user opts out
  if (process.env.MAYROS_SKIP_CORTEX === "1" || process.env.CI === "true") {
    return;
  }

  const binaryPath = join(INSTALL_DIR, BINARY_NAME);

  // Check installed version — skip only if it meets the minimum
  if (existsSync(binaryPath)) {
    try {
      const versionOut = execFileSync(binaryPath, ["--version"], { timeout: 5000 })
        .toString()
        .trim();
      const match = versionOut.match(/v?(\d+\.\d+\.\d+)/);
      if (match) {
        const installed = match[1].split(".").map(Number);
        const required = REQUIRED_VERSION.split(".").map(Number);
        const needsUpdate =
          installed[0] < required[0] ||
          (installed[0] === required[0] && installed[1] < required[1]) ||
          (installed[0] === required[0] &&
            installed[1] === required[1] &&
            installed[2] < required[2]);
        if (!needsUpdate) {
          console.log(
            `[mayros] AIngle Cortex v${match[1]} is up to date (requires >=${REQUIRED_VERSION})`,
          );
          return;
        }
        console.log(
          `[mayros] AIngle Cortex v${match[1]} installed, updating to >=${REQUIRED_VERSION}...`,
        );
      }
    } catch {
      // Can't determine version — proceed with install/update
    }
  }

  const assetName = getPlatformAsset();
  if (!assetName) {
    console.warn(
      `[mayros] Unsupported platform (${platform()}-${arch()}), skipping Cortex install`,
    );
    return;
  }

  console.log(`[mayros] Installing AIngle Cortex (semantic memory)...`);

  // Fetch latest release metadata
  const releaseUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
  const releaseRes = await fetchWithRetry(releaseUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!releaseRes.ok) {
    console.warn(
      `[mayros] Could not fetch Cortex release (${releaseRes.status}). Install later with: mayros update`,
    );
    return;
  }
  const release = await releaseRes.json();
  const asset = release.assets?.find((a) => a.name === assetName);
  if (!asset) {
    console.warn(
      `[mayros] Cortex asset "${assetName}" not found in release ${release.tag_name}. Install later with: mayros update`,
    );
    return;
  }

  await mkdir(INSTALL_DIR, { recursive: true });
  const archivePath = join(INSTALL_DIR, asset.name);

  // Download
  console.log(`[mayros] Downloading ${asset.name}...`);
  const dlRes = await fetchWithRetry(asset.browser_download_url, { redirect: "follow" });
  if (!dlRes.ok || !dlRes.body) {
    console.warn(`[mayros] Download failed (${dlRes.status}). Install later with: mayros update`);
    return;
  }
  const fileStream = createWriteStream(archivePath);
  await pipeline(Readable.fromWeb(dlRes.body), fileStream);

  // Extract
  console.log(`[mayros] Extracting...`);
  if (assetName.endsWith(".zip")) {
    execFileSync("unzip", ["-o", archivePath, "-d", INSTALL_DIR], { timeout: 30_000 });
  } else {
    execFileSync("tar", ["xzf", archivePath, "-C", INSTALL_DIR], { timeout: 30_000 });
  }

  // Find and rename platform-suffixed binary (always check, even on updates)
  const baseName = BINARY_NAME.replace(/\.exe$/, "");
  const candidates = readdirSync(INSTALL_DIR).filter(
    (f) =>
      f.startsWith(baseName + "-") &&
      !f.endsWith(".tar.gz") &&
      !f.endsWith(".zip") &&
      !f.endsWith(".exe.zip"),
  );

  if (candidates.length >= 1) {
    const candidatePath = join(INSTALL_DIR, candidates[0]);

    // On update: move old binary aside before renaming
    if (existsSync(binaryPath)) {
      const oldPath = binaryPath + ".old";
      try {
        if (existsSync(oldPath)) unlinkSync(oldPath);
        renameSync(binaryPath, oldPath);
      } catch {
        // If locked, try direct copy (Windows)
        copyFileSync(candidatePath, binaryPath);
        try {
          unlinkSync(candidatePath);
        } catch {}
        console.log(`[mayros] Overwrote ${BINARY_NAME} with ${candidates[0]}`);
        candidates.length = 0;
      }
    }

    if (candidates.length >= 1) {
      renameSync(candidatePath, binaryPath);
      console.log(`[mayros] Renamed ${candidates[0]} → ${BINARY_NAME}`);
    }

    // Clean up .old
    const oldPath = binaryPath + ".old";
    try {
      if (existsSync(oldPath)) unlinkSync(oldPath);
    } catch {}
  } else if (!existsSync(binaryPath)) {
    console.warn(
      `[mayros] Cortex binary not found after extraction. Install later with: mayros update`,
    );
    try {
      unlinkSync(archivePath);
    } catch {}
    return;
  }

  if (!IS_WIN) {
    chmodSync(binaryPath, 0o755);
  }

  // Cleanup archive and leftover suffixed binaries
  try {
    unlinkSync(archivePath);
  } catch {}
  for (const leftover of readdirSync(INSTALL_DIR).filter(
    (f) => f.startsWith(baseName + "-") && !f.endsWith(".tar.gz") && !f.endsWith(".zip"),
  )) {
    try {
      unlinkSync(join(INSTALL_DIR, leftover));
    } catch {}
  }

  console.log(`[mayros] AIngle Cortex installed at ${binaryPath}`);
}

main().catch((err) => {
  // Never break npm install — just warn
  console.warn(`[mayros] Cortex auto-install failed: ${err.message}`);
  console.warn(`[mayros] Install manually with: mayros update`);
});
