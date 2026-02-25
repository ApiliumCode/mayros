import { describe, expect, it } from "vitest";
import type { MayrosConfig } from "../config/config.js";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";

describe("image sanitization config", () => {
  it("defaults when no config value exists", () => {
    expect(resolveImageSanitizationLimits(undefined)).toEqual({});
    expect(
      resolveImageSanitizationLimits({ agents: { defaults: {} } } as unknown as MayrosConfig),
    ).toEqual({});
  });

  it("reads and normalizes agents.defaults.imageMaxDimensionPx", () => {
    expect(
      resolveImageSanitizationLimits({
        agents: { defaults: { imageMaxDimensionPx: 1600.9 } },
      } as unknown as MayrosConfig),
    ).toEqual({ maxDimensionPx: 1600 });
  });
});
