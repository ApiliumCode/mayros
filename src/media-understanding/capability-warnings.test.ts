import { describe, it, expect } from "vitest";
import { extractCapabilityWarnings, formatCapabilityWarning } from "./capability-warnings.js";
import type { MediaUnderstandingDecision } from "./types.js";

const skippedImageDecision: MediaUnderstandingDecision = {
  capability: "image",
  outcome: "skipped",
  attachments: [{ attachmentIndex: 0, attempts: [] }],
};

const skippedAudioDecision: MediaUnderstandingDecision = {
  capability: "audio",
  outcome: "skipped",
  attachments: [{ attachmentIndex: 1, attempts: [] }],
};

const skippedVideoDecision: MediaUnderstandingDecision = {
  capability: "video",
  outcome: "skipped",
  attachments: [
    { attachmentIndex: 2, attempts: [] },
    { attachmentIndex: 3, attempts: [] },
  ],
};

const successDecision: MediaUnderstandingDecision = {
  capability: "image",
  outcome: "success",
  attachments: [{ attachmentIndex: 0, attempts: [] }],
};

const disabledDecision: MediaUnderstandingDecision = {
  capability: "audio",
  outcome: "disabled",
  attachments: [{ attachmentIndex: 1, attempts: [] }],
};

describe("extractCapabilityWarnings", () => {
  it("returns empty array when no decisions", () => {
    expect(extractCapabilityWarnings([], 3)).toEqual([]);
  });

  it("returns empty array when totalAttachments is 0", () => {
    expect(extractCapabilityWarnings([skippedImageDecision], 0)).toEqual([]);
  });

  it("returns warning for skipped image decision", () => {
    const warnings = extractCapabilityWarnings([skippedImageDecision], 1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.capability).toBe("image");
    expect(warnings[0]!.attachmentCount).toBe(1);
    expect(warnings[0]!.message).toContain("No image provider available");
  });

  it("returns warning for skipped audio decision", () => {
    const warnings = extractCapabilityWarnings([skippedAudioDecision], 1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.capability).toBe("audio");
    expect(warnings[0]!.message).toContain("No audio provider available");
  });

  it("returns warning for skipped video decision", () => {
    const warnings = extractCapabilityWarnings([skippedVideoDecision], 2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.capability).toBe("video");
    expect(warnings[0]!.attachmentCount).toBe(2);
  });

  it("ignores non-skipped decisions (success/disabled)", () => {
    const warnings = extractCapabilityWarnings([successDecision, disabledDecision], 2);
    expect(warnings).toEqual([]);
  });

  it("returns multiple warnings for multiple skipped capabilities", () => {
    const warnings = extractCapabilityWarnings([skippedImageDecision, skippedAudioDecision], 2);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.capability).toBe("image");
    expect(warnings[1]!.capability).toBe("audio");
  });

  it("formats single attachment warning correctly (singular)", () => {
    const warnings = extractCapabilityWarnings([skippedImageDecision], 1);
    expect(warnings[0]!.message).toContain("1 attachment skipped");
    expect(warnings[0]!.message).not.toContain("attachments skipped");
  });

  it("formats multiple attachments warning correctly (plural)", () => {
    const warnings = extractCapabilityWarnings([skippedVideoDecision], 2);
    expect(warnings[0]!.message).toContain("2 attachments skipped");
  });
});

describe("formatCapabilityWarning", () => {
  it("returns the message string", () => {
    const warnings = extractCapabilityWarnings([skippedImageDecision], 1);
    const formatted = formatCapabilityWarning(warnings[0]!);
    expect(formatted).toBe(warnings[0]!.message);
  });
});
