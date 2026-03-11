import { describe, it, expect } from "vitest";
import { TrustManager } from "./trust-tiers.js";

describe("TrustManager", () => {
  it("starts agents at tier 0", () => {
    const mgr = new TrustManager({ promotionThreshold: 0.8, demotionThreshold: 0.3 });
    expect(mgr.getTier("agent-a")).toBe(0);
  });

  it("promotes after enough high-score evaluations", () => {
    const mgr = new TrustManager({ promotionThreshold: 0.8, demotionThreshold: 0.3 });
    for (let i = 0; i < 5; i++) {
      mgr.evaluatePromotion("agent-a", 0.9);
    }
    expect(mgr.getTier("agent-a")).toBe(1);
  });

  it("demotes on low scores", () => {
    const mgr = new TrustManager({ promotionThreshold: 0.8, demotionThreshold: 0.3 });
    mgr.setTier("agent-a", 2);
    mgr.evaluatePromotion("agent-a", 0.1);
    expect(mgr.getTier("agent-a")).toBe(1);
  });

  it("does not promote without enough evaluations", () => {
    const mgr = new TrustManager({ promotionThreshold: 0.8, demotionThreshold: 0.3 });
    for (let i = 0; i < 3; i++) {
      mgr.evaluatePromotion("agent-a", 0.95);
    }
    expect(mgr.getTier("agent-a")).toBe(0); // not enough evals
  });

  it("does not exceed tier 2", () => {
    const mgr = new TrustManager({ promotionThreshold: 0.8, demotionThreshold: 0.3 });
    mgr.setTier("agent-a", 2);
    for (let i = 0; i < 10; i++) {
      mgr.evaluatePromotion("agent-a", 0.95);
    }
    expect(mgr.getTier("agent-a")).toBe(2);
  });
});
