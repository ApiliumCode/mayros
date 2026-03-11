import { describe, it, expect } from "vitest";
import { classifyTask, classifyBudgetLevel, classifyTimeSlot } from "./task-classifier.js";

describe("classifyTask", () => {
  it("classifies code-related prompts", () => {
    expect(classifyTask("implement a function to parse JSON")).toBe("code");
    expect(classifyTask("fix the bug in the login module")).toBe("code");
    expect(classifyTask("debug the runtime error in main.ts")).toBe("code");
    expect(classifyTask("refactor the database query")).toBe("code");
  });

  it("classifies analysis prompts", () => {
    expect(classifyTask("analyze the performance of this algorithm")).toBe("analysis");
    expect(classifyTask("explain how the caching layer works")).toBe("analysis");
    expect(classifyTask("review the security audit report")).toBe("analysis");
  });

  it("classifies creative prompts", () => {
    expect(classifyTask("write a blog post about microservices")).toBe("creative");
    expect(classifyTask("design a new user interface layout")).toBe("creative");
    expect(classifyTask("compose an email template")).toBe("creative");
  });

  it("defaults to chat for generic prompts", () => {
    expect(classifyTask("hello how are you")).toBe("chat");
    expect(classifyTask("what time is it")).toBe("chat");
  });

  it("boosts code score for code-like patterns", () => {
    expect(classifyTask("look at this ```code block```")).toBe("code");
    expect(classifyTask("check the file main.ts")).toBe("code");
  });
});

describe("classifyBudgetLevel", () => {
  it("returns low for undefined", () => {
    expect(classifyBudgetLevel(undefined)).toBe("low");
  });

  it("returns levels based on fraction", () => {
    expect(classifyBudgetLevel(0.1)).toBe("low");
    expect(classifyBudgetLevel(0.5)).toBe("mid");
    expect(classifyBudgetLevel(0.75)).toBe("high");
    expect(classifyBudgetLevel(0.95)).toBe("critical");
  });
});

describe("classifyTimeSlot", () => {
  it("returns peak or off-peak", () => {
    const result = classifyTimeSlot();
    expect(["peak", "off-peak"]).toContain(result);
  });
});
