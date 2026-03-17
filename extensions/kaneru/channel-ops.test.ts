import { describe, expect, it } from "vitest";
import { ChannelOpsService } from "./channel-ops.js";
import type { ChannelNotification } from "./channel-ops.js";
import type { Mission } from "./mission.js";
import type { Venture } from "./venture.js";
import type { FuelSummary } from "./fuel.js";
import type { DecisionRecord } from "./decision-history.js";
import type { MissionOutcome } from "./learning-profiles.js";

// ============================================================================
// Test data factories
// ============================================================================

function makeMission(overrides?: Partial<Mission>): Mission {
  return {
    id: "m-1",
    identifier: "SEC-1",
    title: "Run OWASP scan",
    description: "",
    status: "complete",
    priority: "medium",
    ventureId: "v-1",
    directiveId: null,
    parentId: null,
    claimedBy: null,
    claimRun: null,
    activeRun: null,
    depth: 0,
    createdAt: "2026-01-01T00:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<MissionOutcome>): MissionOutcome {
  return {
    missionId: "m-1",
    agentId: "scanner",
    title: "Run OWASP scan",
    success: true,
    durationMs: 5000,
    ...overrides,
  };
}

function makeVenture(overrides?: Partial<Venture>): Venture {
  return {
    id: "v-1",
    name: "Test Venture",
    directive: "Do things",
    fuelLimit: 10000,
    status: "active",
    prefix: "TST",
    missionCounter: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFuelSummary(overrides?: Partial<FuelSummary>): FuelSummary {
  return {
    ventureId: "v-1",
    totalCents: 0,
    fuelLimit: 10000,
    remaining: 10000,
    burnRate: 10,
    byAgent: [],
    byMission: [],
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<DecisionRecord>): DecisionRecord {
  return {
    id: "d-1",
    question: "Should we deploy v2?",
    strategy: "majority",
    resolvedValue: "yes",
    confidence: 0.8,
    participants: ["scanner", "reviewer"],
    votes: { yes: 2, no: 0 },
    ventureId: "v-1",
    missionId: null,
    decidedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("ChannelOpsService", () => {
  // ----- shouldNotify -----

  describe("shouldNotify", () => {
    it("respects notifyOnMissionComplete config", () => {
      const svc = new ChannelOpsService("test", { notifyOnMissionComplete: false });
      const n: ChannelNotification = {
        type: "mission-complete",
        ventureId: "v-1",
        message: "done",
        priority: "normal",
      };
      expect(svc.shouldNotify(n)).toBe(false);
    });

    it("respects notifyOnFuelAlert config", () => {
      const svc = new ChannelOpsService("test", { notifyOnFuelAlert: false });
      const n: ChannelNotification = {
        type: "fuel-alert",
        ventureId: "v-1",
        message: "low",
        priority: "urgent",
      };
      expect(svc.shouldNotify(n)).toBe(false);
    });

    it("returns true for unmatched types", () => {
      const svc = new ChannelOpsService("test");
      const n: ChannelNotification = {
        type: "pulse-fired",
        ventureId: "v-1",
        message: "pulse",
        priority: "normal",
      };
      expect(svc.shouldNotify(n)).toBe(true);
    });
  });

  // ----- formatNotification -----

  describe("formatNotification", () => {
    it("adds [URGENT] prefix for urgent priority", () => {
      const svc = new ChannelOpsService("test");
      const n: ChannelNotification = {
        type: "fuel-alert",
        ventureId: "v-1",
        message: "Fuel low",
        priority: "urgent",
      };
      expect(svc.formatNotification(n)).toBe("[URGENT] Fuel low");
    });

    it("returns plain message for normal priority", () => {
      const svc = new ChannelOpsService("test");
      const n: ChannelNotification = {
        type: "mission-complete",
        ventureId: "v-1",
        message: "All good",
        priority: "normal",
      };
      expect(svc.formatNotification(n)).toBe("All good");
    });
  });

  // ----- buildMissionReport -----

  describe("buildMissionReport", () => {
    it("formats with duration, agent, and status", () => {
      const svc = new ChannelOpsService("test");
      const report = svc.buildMissionReport(makeMission(), makeOutcome({ durationMs: 12000 }));
      expect(report.message).toContain("SEC-1 completed");
      expect(report.message).toContain("12s");
      expect(report.message).toContain("Agent: scanner");
      expect(report.priority).toBe("normal");
    });

    it("sets urgent priority for failures", () => {
      const svc = new ChannelOpsService("test");
      const report = svc.buildMissionReport(
        makeMission(),
        makeOutcome({ success: false, durationMs: 3000 }),
      );
      expect(report.message).toContain("failed");
      expect(report.priority).toBe("urgent");
    });
  });

  // ----- buildFuelAlert -----

  describe("buildFuelAlert", () => {
    it("returns null under threshold", () => {
      const svc = new ChannelOpsService("test", { fuelAlertThreshold: 80 });
      const alert = svc.buildFuelAlert(
        makeVenture({ fuelLimit: 10000 }),
        makeFuelSummary({ totalCents: 5000 }),
      );
      expect(alert).toBeNull();
    });

    it("returns alert over threshold", () => {
      const svc = new ChannelOpsService("test", { fuelAlertThreshold: 80 });
      const alert = svc.buildFuelAlert(
        makeVenture({ fuelLimit: 10000 }),
        makeFuelSummary({ totalCents: 8500 }),
      );
      expect(alert).not.toBeNull();
      expect(alert!.message).toContain("85%");
      expect(alert!.priority).toBe("normal");
    });

    it("sets urgent at 95%+", () => {
      const svc = new ChannelOpsService("test", { fuelAlertThreshold: 80 });
      const alert = svc.buildFuelAlert(
        makeVenture({ fuelLimit: 10000 }),
        makeFuelSummary({ totalCents: 9600 }),
      );
      expect(alert).not.toBeNull();
      expect(alert!.priority).toBe("urgent");
    });

    it("returns null for unlimited ventures (fuelLimit 0)", () => {
      const svc = new ChannelOpsService("test");
      const alert = svc.buildFuelAlert(
        makeVenture({ fuelLimit: 0 }),
        makeFuelSummary({ totalCents: 99999 }),
      );
      expect(alert).toBeNull();
    });
  });

  // ----- buildDecisionPrompt -----

  describe("buildDecisionPrompt", () => {
    it("includes participants and strategy", () => {
      const svc = new ChannelOpsService("test");
      const prompt = svc.buildDecisionPrompt(makeDecision());
      expect(prompt.message).toContain("Should we deploy v2?");
      expect(prompt.message).toContain("Strategy: majority");
      expect(prompt.message).toContain("scanner, reviewer");
      expect(prompt.type).toBe("decision-pending");
    });

    it("sets urgent for low confidence", () => {
      const svc = new ChannelOpsService("test");
      const prompt = svc.buildDecisionPrompt(makeDecision({ confidence: 0.3 }));
      expect(prompt.priority).toBe("urgent");
    });
  });
});
