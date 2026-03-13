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
  const ext = IS_WIN ? ".zip" : ".tar.gz";
  return `aingle-cortex-${osKey}-${archKey}${ext}`;
}

async function main() {
  // Skip in CI or if user opts out
  if (process.env.MAYROS_SKIP_CORTEX === "1" || process.env.CI === "true") {
    return;
  }

  // Already installed?
  const binaryPath = join(INSTALL_DIR, BINARY_NAME);
  if (existsSync(binaryPath)) {
    console.log(`[mayros] AIngle Cortex already installed at ${binaryPath}`);
    return;
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

  // Verify + rename platform-suffixed binary if needed
  if (!existsSync(binaryPath)) {
    const baseName = BINARY_NAME.replace(/\.exe$/, "");
    const candidates = readdirSync(INSTALL_DIR).filter(
      (f) => f.startsWith(baseName + "-") && !f.endsWith(".tar.gz") && !f.endsWith(".zip"),
    );
    if (candidates.length === 1) {
      renameSync(join(INSTALL_DIR, candidates[0]), binaryPath);
      console.log(`[mayros] Renamed ${candidates[0]} → ${BINARY_NAME}`);
    } else {
      console.warn(
        `[mayros] Cortex binary not found after extraction. Install later with: mayros update`,
      );
      try {
        unlinkSync(archivePath);
      } catch {}
      return;
    }
  }
  if (!IS_WIN) {
    chmodSync(binaryPath, 0o755);
  }

  // Cleanup archive
  try {
    unlinkSync(archivePath);
  } catch {}

  console.log(`[mayros] AIngle Cortex installed at ${binaryPath}`);
}

main().catch((err) => {
  // Never break npm install — just warn
  console.warn(`[mayros] Cortex auto-install failed: ${err.message}`);
  console.warn(`[mayros] Install manually with: mayros update`);
});
