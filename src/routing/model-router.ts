/**
 * Dynamic model routing — selects the best LLM model based on task type,
 * cost constraints, and runtime availability.
 */

export type ModelRoutingStrategy = "default" | "fallback" | "cost-optimized" | "capability";

export type ModelCandidate = {
  id: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  capabilities: string[];
  maxContext: number;
  available: boolean;
};

export type RoutingDecision = {
  model: ModelCandidate;
  strategy: ModelRoutingStrategy;
  reason: string;
  fallbackChain: string[];
};

export type RoutingContext = {
  taskType?: "code" | "chat" | "analysis" | "creative";
  inputTokenEstimate?: number;
  requiresVision?: boolean;
  preferredProvider?: string;
  maxCostPer1k?: number;
  budgetRemainingUsd?: number;
};

export class ModelRouter {
  private models: Map<string, ModelCandidate>;
  private defaultModel: string;
  private fallbackOrder: string[];

  constructor(params: {
    models: ModelCandidate[];
    defaultModel: string;
    fallbackOrder?: string[];
  }) {
    this.models = new Map<string, ModelCandidate>();
    for (const model of params.models) {
      this.models.set(model.id, { ...model });
    }
    this.defaultModel = params.defaultModel;
    this.fallbackOrder = params.fallbackOrder ?? params.models.map((m) => m.id);
  }

  /** Route using the specified strategy. */
  route(strategy: ModelRoutingStrategy, context?: RoutingContext): RoutingDecision {
    switch (strategy) {
      case "default":
        return this.routeDefault(context);
      case "fallback":
        return this.routeFallback(context);
      case "cost-optimized":
        return this.routeCostOptimized(context);
      case "capability":
        return this.routeCapability(context);
    }
  }

  /** Add or update a model candidate. */
  registerModel(model: ModelCandidate): void {
    this.models.set(model.id, { ...model });
  }

  /** Mark a model as unavailable (e.g., rate limited). */
  markUnavailable(modelId: string): void {
    const model = this.models.get(modelId);
    if (model) {
      model.available = false;
    }
  }

  /** Mark a model as available again. */
  markAvailable(modelId: string): void {
    const model = this.models.get(modelId);
    if (model) {
      model.available = true;
    }
  }

  /** List all registered models. */
  listModels(): ModelCandidate[] {
    return [...this.models.values()];
  }

  // ── Private strategies ─────────────────────────────────────────────

  private routeDefault(_context?: RoutingContext): RoutingDecision {
    const fallbackChain: string[] = [];
    const defaultCandidate = this.models.get(this.defaultModel);

    if (defaultCandidate?.available) {
      fallbackChain.push(this.defaultModel);
      return {
        model: { ...defaultCandidate },
        strategy: "default",
        reason: `Default model "${this.defaultModel}" is available`,
        fallbackChain,
      };
    }

    // Default unavailable — try fallback chain
    if (defaultCandidate) {
      fallbackChain.push(this.defaultModel);
    }

    for (const candidateId of this.fallbackOrder) {
      if (candidateId === this.defaultModel) {
        continue;
      }
      const candidate = this.models.get(candidateId);
      fallbackChain.push(candidateId);
      if (candidate?.available) {
        return {
          model: { ...candidate },
          strategy: "default",
          reason: `Default model "${this.defaultModel}" unavailable, fell back to "${candidateId}"`,
          fallbackChain,
        };
      }
    }

    throw new Error("No available models in fallback chain");
  }

  private routeFallback(_context?: RoutingContext): RoutingDecision {
    const fallbackChain: string[] = [];

    for (const candidateId of this.fallbackOrder) {
      const candidate = this.models.get(candidateId);
      fallbackChain.push(candidateId);
      if (candidate?.available) {
        return {
          model: { ...candidate },
          strategy: "fallback",
          reason: `First available model in fallback chain: "${candidateId}"`,
          fallbackChain,
        };
      }
    }

    throw new Error("No available models in fallback chain");
  }

  private routeCostOptimized(context?: RoutingContext): RoutingDecision {
    const fallbackChain: string[] = [];
    const available = [...this.models.values()].filter((m) => m.available);

    let filtered = available;

    if (context?.requiresVision) {
      filtered = filtered.filter((m) => m.capabilities.includes("vision"));
    }

    if (context?.inputTokenEstimate !== undefined && context.inputTokenEstimate > 0) {
      filtered = filtered.filter((m) => m.maxContext >= context.inputTokenEstimate!);
    }

    if (context?.maxCostPer1k !== undefined) {
      filtered = filtered.filter((m) => m.costPer1kInput <= context.maxCostPer1k!);
    }

    // Sort by input cost ascending (cheapest first)
    filtered.sort((a, b) => a.costPer1kInput - b.costPer1kInput);

    for (const candidate of filtered) {
      fallbackChain.push(candidate.id);
    }

    if (filtered.length === 0) {
      throw new Error("No available models matching cost-optimized criteria");
    }

    const chosen = filtered[0]!;
    return {
      model: { ...chosen },
      strategy: "cost-optimized",
      reason: `Cheapest available model: "${chosen.id}" ($${chosen.costPer1kInput}/1k input)`,
      fallbackChain,
    };
  }

  private routeCapability(context?: RoutingContext): RoutingDecision {
    const fallbackChain: string[] = [];
    const available = [...this.models.values()].filter((m) => m.available);

    let filtered = available;

    if (context?.requiresVision) {
      filtered = filtered.filter((m) => m.capabilities.includes("vision"));
    }

    if (context?.inputTokenEstimate !== undefined && context.inputTokenEstimate > 100_000) {
      filtered = filtered.filter((m) => m.capabilities.includes("long-context"));
    }

    if (context?.inputTokenEstimate !== undefined && context.inputTokenEstimate > 0) {
      filtered = filtered.filter((m) => m.maxContext >= context.inputTokenEstimate!);
    }

    if (context?.preferredProvider) {
      const preferred = filtered.filter((m) => m.provider === context.preferredProvider);
      if (preferred.length > 0) {
        filtered = preferred;
      }
    }

    for (const candidate of filtered) {
      fallbackChain.push(candidate.id);
    }

    if (filtered.length === 0) {
      throw new Error("No available models matching capability requirements");
    }

    const chosen = filtered[0]!;
    const requiredCaps: string[] = [];
    if (context?.requiresVision) {
      requiredCaps.push("vision");
    }
    if (context?.inputTokenEstimate !== undefined && context.inputTokenEstimate > 100_000) {
      requiredCaps.push("long-context");
    }

    const capsLabel = requiredCaps.length > 0 ? requiredCaps.join(", ") : "general";
    return {
      model: { ...chosen },
      strategy: "capability",
      reason: `Best capability match for [${capsLabel}]: "${chosen.id}"`,
      fallbackChain,
    };
  }
}
