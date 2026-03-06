import { describe, it, expect, vi } from "vitest";
import { isMediaFile, resolveMediaMention } from "./media-mention.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);

describe("media-mention", () => {
  describe("isMediaFile", () => {
    it("detects image files", () => {
      expect(isMediaFile("/path/to/photo.png")).toBe(true);
      expect(isMediaFile("/path/to/photo.jpg")).toBe(true);
      expect(isMediaFile("/path/to/photo.jpeg")).toBe(true);
      expect(isMediaFile("/path/to/photo.gif")).toBe(true);
      expect(isMediaFile("/path/to/photo.webp")).toBe(true);
      expect(isMediaFile("/path/to/photo.bmp")).toBe(true);
      expect(isMediaFile("/path/to/photo.svg")).toBe(true);
    });

    it("detects audio files", () => {
      expect(isMediaFile("/path/to/song.mp3")).toBe(true);
      expect(isMediaFile("/path/to/sound.wav")).toBe(true);
      expect(isMediaFile("/path/to/track.ogg")).toBe(true);
      expect(isMediaFile("/path/to/audio.flac")).toBe(true);
      expect(isMediaFile("/path/to/voice.m4a")).toBe(true);
      expect(isMediaFile("/path/to/music.opus")).toBe(true);
    });

    it("detects video files", () => {
      expect(isMediaFile("/path/to/video.mp4")).toBe(true);
      expect(isMediaFile("/path/to/movie.mkv")).toBe(true);
      expect(isMediaFile("/path/to/clip.mov")).toBe(true);
      expect(isMediaFile("/path/to/stream.webm")).toBe(true);
    });

    it("rejects non-media files", () => {
      expect(isMediaFile("/path/to/file.ts")).toBe(false);
      expect(isMediaFile("/path/to/readme.md")).toBe(false);
      expect(isMediaFile("/path/to/data.json")).toBe(false);
      expect(isMediaFile("/path/to/style.css")).toBe(false);
    });

    it("handles case-insensitive extensions", () => {
      expect(isMediaFile("/path/to/photo.PNG")).toBe(true);
      expect(isMediaFile("/path/to/video.MP4")).toBe(true);
      expect(isMediaFile("/path/to/song.MP3")).toBe(true);
    });

    it("handles files without extension", () => {
      expect(isMediaFile("/path/to/noext")).toBe(false);
      expect(isMediaFile("")).toBe(false);
    });
  });

  describe("resolveMediaMention", () => {
    it("reads file and returns base64 attachment", async () => {
      const testBuffer = Buffer.from("fake image data");
      mockReadFile.mockResolvedValue(testBuffer);

      const result = await resolveMediaMention("/path/to/photo.png");
      expect(result).not.toBeNull();
      expect(result!.mimeType).toBe("image/png");
      expect(result!.fileName).toBe("photo.png");
      expect(result!.content).toBe(testBuffer.toString("base64"));
    });

    it("returns null for unknown extension", async () => {
      const result = await resolveMediaMention("/path/to/file.xyz");
      expect(result).toBeNull();
    });

    it("returns null if file exceeds 25MB", async () => {
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024);
      mockReadFile.mockResolvedValue(largeBuffer);

      const result = await resolveMediaMention("/path/to/large.mp4");
      expect(result).toBeNull();
    });

    it("returns null if readFile throws", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const result = await resolveMediaMention("/path/to/missing.png");
      expect(result).toBeNull();
    });

    it("maps audio extension to correct mime type", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("audio data"));

      const result = await resolveMediaMention("/path/to/track.mp3");
      expect(result!.mimeType).toBe("audio/mpeg");
    });

    it("maps video extension to correct mime type", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("video data"));

      const result = await resolveMediaMention("/path/to/clip.mp4");
      expect(result!.mimeType).toBe("video/mp4");
    });

    it("maps wav extension correctly", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("wav data"));

      const result = await resolveMediaMention("/path/to/sound.wav");
      expect(result!.mimeType).toBe("audio/wav");
    });

    it("maps jpeg extension correctly", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("jpeg data"));

      const result = await resolveMediaMention("/path/to/photo.jpeg");
      expect(result!.mimeType).toBe("image/jpeg");
    });

    it("maps webm extension correctly", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("webm data"));

      const result = await resolveMediaMention("/path/to/clip.webm");
      expect(result!.mimeType).toBe("video/webm");
    });

    it("extracts filename from path", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("data"));

      const result = await resolveMediaMention("/deep/nested/path/photo.jpg");
      expect(result!.fileName).toBe("photo.jpg");
    });
  });
});
