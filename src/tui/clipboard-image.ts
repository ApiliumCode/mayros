import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ClipboardImage = {
  base64: string;
  mimeType: string;
};

/**
 * Attempts to capture an image from the system clipboard.
 * Returns the image as base64 + mimeType, or null if no image is on the clipboard.
 *
 * Supports macOS (pbpaste/osascript) and Linux (xclip).
 */
export function captureClipboardImage(): ClipboardImage | null {
  if (process.platform === "darwin") {
    return captureMacOS();
  }
  if (process.platform === "linux") {
    return captureLinux();
  }
  return null;
}

function captureMacOS(): ClipboardImage | null {
  try {
    const info = execSync("osascript -e 'clipboard info'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // clipboard info returns something like: «class PNGf», 12345, «class utf8», 0
    if (!info.includes("PNGf") && !info.includes("TIFF")) {
      return null;
    }
  } catch {
    return null;
  }

  const tmpFile = join(tmpdir(), `mayros-clip-${randomUUID()}.png`);
  try {
    // AppleScript to write clipboard image to a temp file as PNG
    const script = [
      "set tmpPath to POSIX file " + JSON.stringify(tmpFile),
      "try",
      "  set imgData to the clipboard as «class PNGf»",
      "on error",
      "  try",
      "    set imgData to the clipboard as «class TIFF»",
      "  on error",
      '    return "none"',
      "  end try",
      "end try",
      "set fRef to open for access tmpPath with write permission",
      "set eof of fRef to 0",
      "write imgData to fRef",
      "close access fRef",
      'return "ok"',
    ].join("\n");

    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (result !== "ok") {
      return null;
    }

    const buf = readFileSync(tmpFile);
    if (buf.length === 0) {
      return null;
    }

    return {
      base64: buf.toString("base64"),
      mimeType: "image/png",
    };
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

function captureLinux(): ClipboardImage | null {
  try {
    // Check if xclip has image data available
    const targets = execSync("xclip -selection clipboard -t TARGETS -o", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!targets.includes("image/png")) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const buf = execSync("xclip -selection clipboard -t image/png -o", {
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50MB max
    });
    if (buf.length === 0) {
      return null;
    }

    return {
      base64: buf.toString("base64"),
      mimeType: "image/png",
    };
  } catch {
    return null;
  }
}
