/**
 * model-advisor — semantic skill runtime
 *
 * Recommends the optimal Claude model based on task requirements,
 * keyword matching against model strengths, and cost analysis.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  label: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  keywords: string[];
  description: string;
}

const MODEL_CATALOG: ModelEntry[] = [
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    inputCostPerMTok: 15,
    outputCostPerMTok: 75,
    keywords: [
      "complex",
      "reasoning",
      "research",
      "multi-step",
      "analysis",
      "architecture",
      "creative",
      "writing",
      "novel",
      "essay",
      "strategy",
      "planning",
      "philosophy",
      "nuance",
      "synthesis",
      "advanced",
      "difficult",
      "deep",
      "expert",
      "comprehensive",
    ],
    description:
      "Best for complex reasoning, research, multi-step analysis, code architecture, and creative writing",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
    keywords: [
      "code",
      "coding",
      "programming",
      "general",
      "data",
      "moderate",
      "refactor",
      "debug",
      "implement",
      "function",
      "api",
      "test",
      "review",
      "build",
      "develop",
      "translate",
      "summarize",
      "explain",
      "convert",
      "generate",
    ],
    description: "Best for coding, general tasks, data analysis, and moderate complexity work",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    inputCostPerMTok: 0.8,
    outputCostPerMTok: 4,
    keywords: [
      "classify",
      "classification",
      "extract",
      "extraction",
      "simple",
      "quick",
      "fast",
      "label",
      "tag",
      "sort",
      "filter",
      "parse",
      "validate",
      "format",
      "lookup",
      "trivial",
      "batch",
      "volume",
      "latency",
      "lightweight",
    ],
    description: "Best for classification, extraction, simple Q&A, high volume, and low latency",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(results: Array<{ subject: string; object: unknown }>): string {
  return results
    .map((r) => {
      const subj = r.subject;
      const obj = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      return `${subj} ${obj}`;
    })
    .join(" ")
    .toLowerCase();
}

function scoreModels(text: string): Array<{ model: ModelEntry; score: number }> {
  return MODEL_CATALOG.map((model) => {
    let score = 0;
    for (const kw of model.keywords) {
      if (text.includes(kw)) {
        score += 1;
      }
    }
    // Cost efficiency bonus: cheaper models get a small bonus when scores are close
    const costFactor = 1 / (model.inputCostPerMTok + model.outputCostPerMTok);
    score += costFactor * 0.5;
    return { model, score };
  }).sort((a, b) => b.score - a.score);
}

function buildCostComparison(): string {
  return MODEL_CATALOG.map(
    (m) => `${m.label}: $${m.inputCostPerMTok}/$${m.outputCostPerMTok} per MTok (in/out)`,
  ).join("; ");
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "model-advisor",

  async onActivate(ctx) {
    ctx.logger.info(`model-advisor: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const text = extractText(ctx.results);
    const scored = scoreModels(text);
    const top = scored[0];

    if (!top) {
      return {
        results: ctx.results,
        additionalContext:
          "[model-advisor] No recommendation could be determined from the provided context.",
      };
    }

    const recommended = top.model;
    const matchedKeywords = recommended.keywords.filter((kw) => text.includes(kw));
    const rationale =
      matchedKeywords.length > 0
        ? `Matched keywords: ${matchedKeywords.join(", ")}. ${recommended.description}.`
        : `Default recommendation based on cost efficiency. ${recommended.description}.`;

    const enriched = ctx.results.map((r) => ({
      subject: r.subject,
      object: {
        original: r.object,
        recommendation: {
          model: recommended.id,
          label: recommended.label,
          rationale,
          inputCostPerMTok: recommended.inputCostPerMTok,
          outputCostPerMTok: recommended.outputCostPerMTok,
        },
      },
    }));

    const costLine = buildCostComparison();

    return {
      results: enriched,
      additionalContext: `[model-advisor] Recommendation: ${recommended.label} -- ${rationale} (cost: $${recommended.inputCostPerMTok}/$${recommended.outputCostPerMTok} per MTok). All models: ${costLine}`,
    };
  },
};

export default runtime;
