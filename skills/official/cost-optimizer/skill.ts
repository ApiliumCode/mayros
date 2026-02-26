/**
 * cost-optimizer — semantic skill runtime
 *
 * Detects cost optimization opportunities for Claude API usage
 * by analyzing usage patterns against embedded pricing data.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Pricing data (USD per million tokens)
// ---------------------------------------------------------------------------

type ModelPricing = {
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

const PRICING: ModelPricing[] = [
  {
    model: "claude-opus-4-6",
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  {
    model: "claude-sonnet-4-6",
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  {
    model: "claude-haiku-4-5",
    input: 0.8,
    output: 4,
    cacheWrite: 1.0,
    cacheRead: 0.08,
  },
];

const BATCH_DISCOUNT = 0.5; // 50% discount

// ---------------------------------------------------------------------------
// Optimization rules
// ---------------------------------------------------------------------------

type OptimizationRule = {
  id: string;
  name: string;
  description: string;
  savings: string;
  keywords: RegExp;
};

const OPTIMIZATION_RULES: OptimizationRule[] = [
  {
    id: "prompt-caching",
    name: "Prompt Caching",
    description:
      "Repeated system prompts detected. Enable prompt caching to avoid re-processing identical prefixes on every request.",
    savings: "Up to 90% on cached input reads",
    keywords:
      /system prompt|repeated prompt|same instructions|identical prefix|reuse prompt|static prompt/i,
  },
  {
    id: "model-downgrade",
    name: "Model Downgrade",
    description:
      "Simple tasks (classification, extraction, formatting) can use Haiku instead of Opus or Sonnet for significant savings.",
    savings: "Up to 94% vs Opus (Haiku input: $0.80 vs Opus input: $15 per MTok)",
    keywords:
      /classification|extraction|formatting|simple task|categoriz|label|tag|parse|convert format|straightforward/i,
  },
  {
    id: "batch-api",
    name: "Batch API",
    description:
      "Non-urgent or bulk processing workloads can use the Batch API for a 50% discount on all models.",
    savings: "50% on all model pricing",
    keywords:
      /batch|bulk|queue|non-urgent|async processing|offline|scheduled|large volume|mass processing/i,
  },
  {
    id: "streaming",
    name: "Streaming",
    description:
      "For interactive use cases where time-to-first-token matters, enable streaming to improve perceived latency at the same cost.",
    savings: "Improved UX at the same cost (no price difference)",
    keywords:
      /latency|time to first|interactive|real-time|user-facing|chat|conversational|responsive/i,
  },
  {
    id: "output-limits",
    name: "Output Limits",
    description:
      "Long responses detected. Set max_tokens to limit output length and reduce output token costs.",
    savings: "Variable based on output reduction (output tokens cost 5x input)",
    keywords:
      /long response|verbose|detailed output|large output|max_tokens|output length|token limit|too many tokens/i,
  },
  {
    id: "context-trimming",
    name: "Context Trimming",
    description:
      "Large context windows detected. Summarize or use retrieval to reduce input tokens.",
    savings: "Proportional to input token reduction",
    keywords:
      /large context|long context|full document|entire file|whole codebase|context window|input tokens|token count|summariz|retrieval/i,
  },
];

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

type Opportunity = {
  ruleId: string;
  name: string;
  description: string;
  savings: string;
};

function detectOpportunities(text: string): Opportunity[] {
  const found: Opportunity[] = [];
  for (const rule of OPTIMIZATION_RULES) {
    if (rule.keywords.test(text)) {
      found.push({
        ruleId: rule.id,
        name: rule.name,
        description: rule.description,
        savings: rule.savings,
      });
    }
  }
  return found;
}

function getModelPricing(text: string): ModelPricing | null {
  const lower = text.toLowerCase();
  if (lower.includes("opus")) return PRICING[0];
  if (lower.includes("sonnet")) return PRICING[1];
  if (lower.includes("haiku")) return PRICING[2];
  return null;
}

function formatPricingContext(model: ModelPricing): string {
  return (
    `${model.model}: input $${model.input}/MTok, output $${model.output}/MTok, ` +
    `cache_write $${model.cacheWrite}/MTok, cache_read $${model.cacheRead}/MTok` +
    ` (Batch: 50% discount)`
  );
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "cost-optimizer",

  async onActivate(ctx) {
    ctx.logger.info(`cost-optimizer: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const allOpportunities: Opportunity[] = [];
    const seenRules = new Set<string>();

    const enriched = ctx.results.map((r) => {
      const text = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      const opportunities = detectOpportunities(text);
      const pricing = getModelPricing(text);

      // Deduplicate across results
      const newOpportunities = opportunities.filter((o) => {
        if (seenRules.has(o.ruleId)) return false;
        seenRules.add(o.ruleId);
        return true;
      });
      allOpportunities.push(...newOpportunities);

      if (opportunities.length === 0 && !pricing) {
        return { subject: r.subject, object: { value: r.object, costAnalysis: null } };
      }

      return {
        subject: r.subject,
        object: {
          value: r.object,
          costAnalysis: {
            opportunities: opportunities.map((o) => ({
              rule: o.name,
              savings: o.savings,
            })),
            detectedModel: pricing ? formatPricingContext(pricing) : null,
            batchDiscount: `${BATCH_DISCOUNT * 100}%`,
          },
        },
      };
    });

    const total = allOpportunities.length;
    const summary =
      total > 0
        ? `[cost-optimizer] Found ${total} optimization ${total === 1 ? "opportunity" : "opportunities"} with estimated savings: ${allOpportunities.map((o) => `${o.name} (${o.savings})`).join("; ")}`
        : `[cost-optimizer] No optimization opportunities detected in ${ctx.results.length} results`;

    return {
      results: enriched,
      additionalContext: summary,
    };
  },

  async onError(ctx) {
    ctx.logger.error(`cost-optimizer: error during ${ctx.operation}: ${ctx.error.message}`);
  },
};

export default runtime;
