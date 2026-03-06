/**
 * Media Mention Handler
 *
 * Detects media file mentions (@path/to/image.png) and converts them
 * to ChatAttachmentInput objects for the gateway.
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ChatAttachmentInput } from "./gateway-chat.js";

const MEDIA_EXTENSIONS = new Set([
  // audio
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  // video
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".flv",
  // image
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
  ".opus": "audio/opus",
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".flv": "video/x-flv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const MAX_MEDIA_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Returns true if the file path has a known media extension.
 */
export function isMediaFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext);
}

/**
 * Resolves a media file path to a ChatAttachmentInput.
 * Returns null if the file cannot be read or exceeds size limits.
 */
export async function resolveMediaMention(filePath: string): Promise<ChatAttachmentInput | null> {
  try {
    const ext = extname(filePath).toLowerCase();
    const mimeType = EXTENSION_TO_MIME[ext];
    if (!mimeType) return null;

    const buffer = await readFile(filePath);
    if (buffer.length > MAX_MEDIA_SIZE) return null;

    const content = buffer.toString("base64");
    const fileName = filePath.split("/").pop() ?? filePath;

    return { mimeType, fileName, content };
  } catch {
    return null;
  }
}

/**
 * Returns the media kind for a file path based on its extension,
 * or null if the extension is not a known media type.
 */
export function getMediaKind(filePath: string): "image" | "audio" | "video" | null {
  const ext = extname(filePath).toLowerCase();
  const mime = EXTENSION_TO_MIME[ext];
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return null;
}
