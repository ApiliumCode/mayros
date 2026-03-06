/**
 * Set the terminal window title via escape sequences.
 * Uses OSC 0 (set window title) and OSC 2 (set icon name and title).
 */
export function setWindowTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  // OSC 2 ; title ST
  process.stdout.write(`\x1b]2;${sanitizeTitle(title)}\x07`);
}

export function resetWindowTitle(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b]2;\x07");
}

export function buildSessionTitle(parts: {
  agent?: string;
  model?: string;
  session?: string;
}): string {
  const segments: string[] = ["Mayros"];
  if (parts.agent) segments.push(parts.agent);
  if (parts.model) segments.push(parts.model);
  if (parts.session) segments.push(`[${parts.session}]`);
  return segments.join(" — ");
}

export function sanitizeTitle(title: string): string {
  // Remove control chars and limit length
  return title.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 100);
}
