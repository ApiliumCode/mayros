/**
 * changelog-tracker — semantic skill runtime
 *
 * Monitors version changes with semantic versioning analysis and
 * breaking change detection. Parses semver strings, classifies
 * bump types, and scans for 7 breaking change indicators.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Semver types and parsing
// ---------------------------------------------------------------------------

type SemverVersion = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

type BumpType = "major" | "minor" | "patch" | "none";

type VersionComparison = {
  from: SemverVersion;
  to: SemverVersion;
  bump: BumpType;
  label: string;
};

const SEMVER_REGEX = /\bv?(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?\b/g;

function parseSemver(raw: string, major: string, minor: string, patch: string): SemverVersion {
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    raw,
  };
}

function extractVersions(text: string): SemverVersion[] {
  const versions: SemverVersion[] = [];
  const seen = new Set<string>();

  let match = SEMVER_REGEX.exec(text);
  while (match !== null) {
    const key = `${match[1]}.${match[2]}.${match[3]}`;
    if (!seen.has(key)) {
      seen.add(key);
      versions.push(parseSemver(match[0], match[1], match[2], match[3]));
    }
    match = SEMVER_REGEX.exec(text);
  }
  SEMVER_REGEX.lastIndex = 0;

  return versions;
}

function compareSemver(from: SemverVersion, to: SemverVersion): VersionComparison {
  let bump: BumpType;
  let label: string;

  if (to.major > from.major) {
    bump = "major";
    label = "Breaking change (major version bump)";
  } else if (to.major < from.major) {
    bump = "major";
    label = "Major version downgrade";
  } else if (to.minor > from.minor) {
    bump = "minor";
    label = "New feature (minor version bump)";
  } else if (to.minor < from.minor) {
    bump = "minor";
    label = "Minor version downgrade";
  } else if (to.patch > from.patch) {
    bump = "patch";
    label = "Bug fix (patch version bump)";
  } else if (to.patch < from.patch) {
    bump = "patch";
    label = "Patch version downgrade";
  } else {
    bump = "none";
    label = "No version change";
  }

  return { from, to, bump, label };
}

// ---------------------------------------------------------------------------
// Breaking change indicators
// ---------------------------------------------------------------------------

type BreakingIndicator = {
  id: string;
  name: string;
  pattern: RegExp;
};

const BREAKING_INDICATORS: BreakingIndicator[] = [
  {
    id: "explicit-breaking",
    name: "Explicit breaking change declaration",
    pattern: /breaking\s+change|BREAKING/i,
  },
  {
    id: "removed-api",
    name: "Removal of API surface",
    pattern:
      /removed\s+(?:the\s+)?(?:api|endpoint|method|function|field|parameter|property|interface|class)/i,
  },
  {
    id: "deprecated-removed",
    name: "Previously deprecated item removed",
    pattern:
      /deprecated\s+(?:\w+\s+)*(?:has\s+been\s+|was\s+|now\s+)?removed|deprecated\s+and\s+removed/i,
  },
  {
    id: "incompatible",
    name: "Explicit incompatibility statement",
    pattern: /incompatible|not\s+backward[s]?\s+compatible|backwards?\s+incompatible/i,
  },
  {
    id: "migration-required",
    name: "Migration needed for upgrade",
    pattern:
      /migration\s+required|requires?\s+migration|need\s+to\s+migrate|migrate\s+(?:from|to|your)/i,
  },
  {
    id: "renamed-api",
    name: "API surface renamed",
    pattern:
      /renamed\s+(?:the\s+)?(?:api|endpoint|method|function|field|parameter|property|interface|class)/i,
  },
  {
    id: "changed-signature",
    name: "Function signature changes",
    pattern:
      /changed\s+signature|signature\s+changed|new\s+parameter\s+required|required\s+parameter\s+added/i,
  },
];

type DetectedBreaking = {
  indicatorId: string;
  name: string;
  evidence: string;
};

function detectBreakingChanges(text: string): DetectedBreaking[] {
  const found: DetectedBreaking[] = [];

  for (const indicator of BREAKING_INDICATORS) {
    const match = indicator.pattern.exec(text);
    if (match) {
      found.push({
        indicatorId: indicator.id,
        name: indicator.name,
        evidence: match[0].slice(0, 80),
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Analysis result types
// ---------------------------------------------------------------------------

type ChangelogAnalysis = {
  versions: SemverVersion[];
  comparisons: VersionComparison[];
  breakingChanges: DetectedBreaking[];
  hasMajorBump: boolean;
};

function analyzeChangelog(text: string): ChangelogAnalysis {
  const versions = extractVersions(text);
  const breakingChanges = detectBreakingChanges(text);
  const comparisons: VersionComparison[] = [];
  let hasMajorBump = false;

  // Compare consecutive version pairs (assumes chronological order in text)
  for (let i = 0; i < versions.length - 1; i++) {
    const cmp = compareSemver(versions[i], versions[i + 1]);
    comparisons.push(cmp);
    if (cmp.bump === "major") {
      hasMajorBump = true;
    }
  }

  // Also flag as major bump if breaking indicators found even without version pairs
  if (breakingChanges.length > 0) {
    hasMajorBump = true;
  }

  return { versions, comparisons, breakingChanges, hasMajorBump };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "changelog-tracker",

  async onActivate(ctx) {
    ctx.logger.info(`changelog-tracker: activated for agent ${ctx.agentId}`);

    // Seed a tracking triple to record initialization
    try {
      await ctx.graphClient.createTriple({
        subject: `${ctx.namespace}:changelog:tracker`,
        predicate: "changelog:initialized",
        object: JSON.stringify({
          timestamp: new Date().toISOString(),
          agentId: ctx.agentId,
          sessionId: ctx.sessionId ?? "unknown",
        }),
      });
      ctx.logger.info("changelog-tracker: tracking triple seeded");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(`changelog-tracker: could not seed tracking triple: ${msg}`);
    }
  },

  async onQuery(ctx) {
    let totalVersionChanges = 0;
    let totalBreaking = 0;

    const enriched = ctx.results.map((r) => {
      const text = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      const analysis = analyzeChangelog(text);

      totalVersionChanges += analysis.comparisons.length;
      totalBreaking += analysis.breakingChanges.length;

      if (analysis.versions.length === 0 && analysis.breakingChanges.length === 0) {
        return {
          subject: r.subject,
          object: { value: r.object, changelogAnalysis: null },
        };
      }

      return {
        subject: r.subject,
        object: {
          value: r.object,
          changelogAnalysis: {
            versionsFound: analysis.versions.map((v) => v.raw),
            comparisons: analysis.comparisons.map((c) => ({
              from: c.from.raw,
              to: c.to.raw,
              bump: c.bump,
              label: c.label,
            })),
            breakingChanges: analysis.breakingChanges.map((b) => ({
              indicator: b.name,
              evidence: b.evidence,
            })),
            hasMajorBump: analysis.hasMajorBump,
          },
        },
      };
    });

    const total = ctx.results.length;
    const summary =
      `[changelog-tracker] Analyzed ${total} item${total === 1 ? "" : "s"}: ` +
      `${totalVersionChanges} version change${totalVersionChanges === 1 ? "" : "s"}, ` +
      `${totalBreaking} breaking change${totalBreaking === 1 ? "" : "s"} detected`;

    return {
      results: enriched,
      additionalContext: summary,
    };
  },

  async onError(ctx) {
    ctx.logger.error(`changelog-tracker: error during ${ctx.operation}: ${ctx.error.message}`);
  },
};

export default runtime;
