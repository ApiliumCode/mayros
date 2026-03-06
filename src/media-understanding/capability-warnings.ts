import type { MediaUnderstandingCapability, MediaUnderstandingDecision } from "./types.js";

export type MediaCapabilityWarning = {
  capability: MediaUnderstandingCapability;
  attachmentCount: number;
  message: string;
};

const CAPABILITY_LABELS: Record<MediaUnderstandingCapability, string> = {
  image: "image",
  audio: "audio",
  video: "video",
};

export function extractCapabilityWarnings(
  decisions: MediaUnderstandingDecision[],
  totalAttachments: number,
): MediaCapabilityWarning[] {
  if (totalAttachments === 0) return [];

  const warnings: MediaCapabilityWarning[] = [];
  for (const decision of decisions) {
    if (decision.outcome !== "skipped") continue;
    const count = decision.attachments.length;
    if (count === 0) continue;

    const label = CAPABILITY_LABELS[decision.capability] ?? decision.capability;
    const plural = count === 1 ? "attachment" : "attachments";
    const message = `No ${label} provider available (${count} ${plural} skipped). Switch models with /model.`;
    warnings.push({
      capability: decision.capability,
      attachmentCount: count,
      message,
    });
  }
  return warnings;
}

export function formatCapabilityWarning(w: MediaCapabilityWarning): string {
  return w.message;
}
