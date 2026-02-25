/**
 * Parse markdown memory files (MEMORY.md, memory/*.md, MAYROS.md) into
 * structured entries for migration into the semantic graph.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type ParsedMemoryFile = {
  filename: string;
  entries: ParsedMemoryEntry[];
};

export type ParsedMemoryEntry = {
  text: string;
  category: string;
  importance: number;
  source: string;
  section?: string;
};

export type ParsedIdentityField = {
  field: string;
  value: string;
};

export type ParsedMayrosMd = {
  identityFields: ParsedIdentityField[];
  instructions: string[];
  rawSections: Record<string, string>;
};

// ============================================================================
// Memory file parsing
// ============================================================================

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want|always|never/i.test(lower)) return "preference";
  if (/decided|will use|chose|agreed|we should/i.test(lower)) return "decision";
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called|named|is my/i.test(lower)) return "entity";
  if (/is|are|has|have|runs on|uses|supports/i.test(lower)) return "fact";
  return "other";
}

/**
 * Parse a single markdown file into memory entries.
 * Each bullet point becomes one entry. Headings provide section context.
 */
export function parseMemoryFile(content: string, filename: string): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  const lines = content.split("\n");

  let currentSection = "";
  let bodyLines: string[] = [];

  const flushBody = () => {
    if (bodyLines.length > 0) {
      const text = bodyLines.join("\n").trim();
      if (text.length >= 5) {
        entries.push({
          text: currentSection ? `${currentSection}: ${text}` : text,
          category: detectCategory(text),
          importance: 0.6,
          source: filename,
          section: currentSection || undefined,
        });
      }
      bodyLines = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Heading
    if (/^#{1,3}\s/.test(line)) {
      flushBody();
      currentSection = line.replace(/^#+\s*/, "").trim();
      continue;
    }

    // Bullet point → standalone entry
    if (/^[-*]\s/.test(line)) {
      flushBody();
      const text = line.replace(/^[-*]\s+/, "").trim();
      if (text.length >= 5) {
        entries.push({
          text: currentSection ? `${currentSection}: ${text}` : text,
          category: detectCategory(text),
          importance: 0.6,
          source: filename,
          section: currentSection || undefined,
        });
      }
      continue;
    }

    // Nested bullet (indented) → same treatment
    if (/^\s+[-*]\s/.test(line)) {
      const text = line.replace(/^\s+[-*]\s+/, "").trim();
      if (text.length >= 5) {
        entries.push({
          text: currentSection ? `${currentSection}: ${text}` : text,
          category: detectCategory(text),
          importance: 0.5,
          source: filename,
          section: currentSection || undefined,
        });
      }
      continue;
    }

    // Body text
    if (line.trim().length > 0) {
      bodyLines.push(line);
    } else {
      flushBody();
    }
  }

  flushBody();
  return entries;
}

// ============================================================================
// MAYROS.md parsing (identity-focused)
// ============================================================================

/**
 * Parse MAYROS.md for both identity fields and general instructions.
 */
export function parseMayrosMd(content: string): ParsedMayrosMd {
  const identityFields: ParsedIdentityField[] = [];
  const instructions: string[] = [];
  const rawSections: Record<string, string> = {};

  const lines = content.split("\n");
  let currentSection = "";
  let sectionBody: string[] = [];

  const flushSection = () => {
    if (currentSection && sectionBody.length > 0) {
      rawSections[currentSection] = sectionBody.join("\n").trim();
    }
    sectionBody = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^#{1,3}\s/.test(line)) {
      flushSection();
      currentSection = line.replace(/^#+\s*/, "").trim();
      continue;
    }

    sectionBody.push(line);

    // Key: value patterns
    const kvMatch = line.match(/^(\w[\w\s]*?):\s+(.+)/);
    if (kvMatch) {
      identityFields.push({
        field: kvMatch[1].trim().toLowerCase(),
        value: kvMatch[2].trim(),
      });
    }

    // Bullet instructions
    if (/^[-*]\s/.test(line)) {
      const text = line.replace(/^[-*]\s+/, "").trim();
      if (text.length >= 5) {
        instructions.push(text);
      }
    }
  }

  flushSection();
  return { identityFields, instructions, rawSections };
}

// ============================================================================
// Directory scanning
// ============================================================================

/**
 * Scan a workspace directory for all memory-related markdown files.
 */
export async function scanWorkspace(workspaceDir: string): Promise<{
  mayrosMd: string | null;
  memoryMd: string | null;
  memoryFiles: string[];
  sessionFiles: string[];
}> {
  const result = {
    mayrosMd: null as string | null,
    memoryMd: null as string | null,
    memoryFiles: [] as string[],
    sessionFiles: [] as string[],
  };

  // Check MAYROS.md
  const mayrosPath = join(workspaceDir, "MAYROS.md");
  try {
    await stat(mayrosPath);
    result.mayrosMd = mayrosPath;
  } catch {
    // not found
  }

  // Check MEMORY.md
  const memoryPath = join(workspaceDir, "MEMORY.md");
  try {
    await stat(memoryPath);
    result.memoryMd = memoryPath;
  } catch {
    // not found
  }

  // Scan memory/ directory
  const memoryDir = join(workspaceDir, "memory");
  try {
    const files = await readdir(memoryDir);
    for (const f of files) {
      if (f.endsWith(".md")) {
        result.memoryFiles.push(join(memoryDir, f));
      }
    }
  } catch {
    // directory doesn't exist
  }

  // Scan for session history files (.jsonl)
  try {
    const files = await readdir(workspaceDir);
    for (const f of files) {
      if (f.endsWith(".jsonl")) {
        result.sessionFiles.push(join(workspaceDir, f));
      }
    }
  } catch {
    // scan failed
  }

  return result;
}
