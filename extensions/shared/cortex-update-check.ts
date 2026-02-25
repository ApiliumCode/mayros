/**
 * Cortex Update Check & Installer
 *
 * Provides helpers to:
 *  - Check whether the installed cortex binary satisfies the minimum
 *    version required by this MAYROS release.
 *  - Download and install/update the cortex binary from GitHub Releases.
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, chmod, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  locateCortexBinary,
  getDefaultInstallDir,
  getBinaryName,
  getCortexBinaryVersion,
} from "./cortex-binary-locator.js";
import { REQUIRED_CORTEX_VERSION } from "./cortex-version.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CortexUpdateStatus = {
  installedVersion: string | null;
  requiredVersion: string;
  latestRelease: string | null;
  needsUpdate: boolean;
};

type GHRelease = {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

// ---------------------------------------------------------------------------
// Version comparison (minimal semver)
// ---------------------------------------------------------------------------

function semverLessThan(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Platform helpers (same logic as scripts/install-cortex.ts)
// ---------------------------------------------------------------------------

const REPO_OWNER = "apilium";
const REPO_NAME = "aingle";

function getPlatformKey(): string {
  const os = process.platform;
  const arch = process.arch;
  const osMap: Record<string, string> = { linux: "linux", darwin: "macos", win32: "windows" };
  const archMap: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };
  const osKey = osMap[os];
  const archKey = archMap[arch];
  if (!osKey || !archKey) throw new Error(`Unsupported platform: ${os}-${arch}`);
  return `${osKey}-${archKey}`;
}

function getAssetPattern(): string {
  const platform = getPlatformKey();
  const ext = process.platform === "win32" ? ".zip" : ".tar.gz";
  return `aingle-cortex-${platform}${ext}`;
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function fetchLatestRelease(): Promise<GHRelease> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GHRelease;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  const fileStream = createWriteStream(dest);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(Readable.fromWeb(res.body as any), fileStream);
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  execFileSync("tar", ["xzf", archivePath, "-C", destDir], { timeout: 30_000 });
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  execFileSync("unzip", ["-o", archivePath, "-d", destDir], { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the installed cortex binary satisfies the minimum version.
 */
export async function checkCortexVersion(binaryPath?: string): Promise<CortexUpdateStatus> {
  const resolved = binaryPath ?? (await locateCortexBinary());
  const installedVersion = resolved ? getCortexBinaryVersion(resolved) : null;
  const needsUpdate =
    !installedVersion || semverLessThan(installedVersion, REQUIRED_CORTEX_VERSION);

  return {
    installedVersion,
    requiredVersion: REQUIRED_CORTEX_VERSION,
    latestRelease: null, // filled lazily only when needed
    needsUpdate,
  };
}

/**
 * Download and install (or update) the cortex binary from GitHub Releases.
 * Returns `true` on success.
 */
export async function installOrUpdateCortex(
  log: (msg: string) => void = () => {},
): Promise<boolean> {
  const installDir = getDefaultInstallDir();
  const binaryName = getBinaryName();
  const assetName = getAssetPattern();

  log(`Platform: ${getPlatformKey()}`);
  log(`Looking for asset: ${assetName}`);

  log("Fetching latest release...");
  const release = await fetchLatestRelease();
  log(`Latest: ${release.tag_name}`);

  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    const available = release.assets.map((a) => a.name).join(", ");
    throw new Error(
      `No matching asset "${assetName}" in release ${release.tag_name}. Available: ${available}`,
    );
  }

  await mkdir(installDir, { recursive: true });
  const archivePath = join(installDir, asset.name);

  log(`Downloading ${asset.name}...`);
  await downloadFile(asset.browser_download_url, archivePath);
  log("Download complete.");

  log("Extracting...");
  if (asset.name.endsWith(".zip")) {
    await extractZip(archivePath, installDir);
  } else {
    await extractTarGz(archivePath, installDir);
  }

  const binaryPath = join(installDir, binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found after extraction: ${binaryPath}`);
  }

  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }

  try {
    await unlink(archivePath);
  } catch {
    // best-effort cleanup
  }

  const version = getCortexBinaryVersion(binaryPath);
  log(`Installed: ${binaryPath} (v${version ?? "unknown"})`);
  return true;
}
