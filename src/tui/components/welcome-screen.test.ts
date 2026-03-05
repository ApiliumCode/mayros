import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../terminal/ansi.js";
import {
  buildShieldArt,
  centerInWidth,
  colorShieldArt,
  padToWidth,
  WelcomeScreen,
} from "./welcome-screen.js";

// ── buildShieldArt ─────────────────────────────────────────────────

describe("buildShieldArt", () => {
  it("returns 5 lines", () => {
    expect(buildShieldArt()).toHaveLength(5);
  });

  it("returns plain strings without ANSI codes", () => {
    for (const line of buildShieldArt()) {
      expect(line).toBe(stripAnsi(line));
    }
  });

  it("contains block characters for the shield", () => {
    const art = buildShieldArt();
    const joined = art.join("\n");
    expect(joined).toContain("█");
    expect(joined).toContain("▄");
    expect(joined).toContain("▀");
  });

  it("contains face characters (eyes and smile)", () => {
    const joined = buildShieldArt().join("\n");
    expect(joined).toContain("●");
    expect(joined).toContain("◡");
  });

  it("does not contain noisy shading characters", () => {
    const joined = buildShieldArt().join("\n");
    expect(joined).not.toContain("▓");
    expect(joined).not.toContain("▒");
    expect(joined).not.toContain("░");
  });

  it("returns a fresh copy each call", () => {
    const a = buildShieldArt();
    const b = buildShieldArt();
    expect(a).toEqual(b);
    a[0] = "modified";
    expect(b[0]).not.toBe("modified");
  });
});

// ── colorShieldArt ─────────────────────────────────────────────────

describe("colorShieldArt", () => {
  it("returns 5 lines", () => {
    expect(colorShieldArt()).toHaveLength(5);
  });

  it("applies color via provided functions", () => {
    const gold = (t: string) => `<<${t}>>`;
    const colored = colorShieldArt({ gold, amber: gold, bronze: gold });
    for (const line of colored) {
      expect(line).toMatch(/^<<.*>>$/);
    }
  });

  it("preserves visible text after stripping ANSI", () => {
    const raw = buildShieldArt();
    const colored = colorShieldArt();
    for (let i = 0; i < raw.length; i++) {
      expect(stripAnsi(colored[i]!)).toBe(raw[i]);
    }
  });

  it("accepts custom color functions per zone", () => {
    const gold = (t: string) => `[G]${t}[/G]`;
    const amber = (t: string) => `[A]${t}[/A]`;
    const bronze = (t: string) => `[B]${t}[/B]`;
    const colored = colorShieldArt({ gold, amber, bronze });
    // lines 0-1: gold
    expect(colored[0]).toMatch(/^\[G\].*\[\/G\]$/);
    expect(colored[1]).toMatch(/^\[G\].*\[\/G\]$/);
    // line 2: amber
    expect(colored[2]).toMatch(/^\[A\].*\[\/A\]$/);
    // lines 3-4: bronze
    expect(colored[3]).toMatch(/^\[B\].*\[\/B\]$/);
    expect(colored[4]).toMatch(/^\[B\].*\[\/B\]$/);
  });
});

// ── padToWidth ─────────────────────────────────────────────────────

describe("padToWidth", () => {
  it("pads short strings with spaces", () => {
    const result = padToWidth("hi", 10);
    expect(result).toBe("hi        ");
  });

  it("does not change strings already at target width", () => {
    expect(padToWidth("abcde", 5)).toBe("abcde");
  });

  it("truncates strings longer than target width", () => {
    const result = padToWidth("hello world", 5);
    expect(stripAnsi(result).length).toBeLessThanOrEqual(5);
  });

  it("handles empty string", () => {
    expect(padToWidth("", 4)).toBe("    ");
  });
});

// ── centerInWidth ──────────────────────────────────────────────────

describe("centerInWidth", () => {
  it("centers text with even padding", () => {
    const result = centerInWidth("AB", 6);
    expect(result).toBe("  AB  ");
  });

  it("centers text with odd remainder (extra space on right)", () => {
    const result = centerInWidth("AB", 7);
    // left = floor((7-2)/2) = 2, right = 7-2-2 = 3
    expect(result).toBe("  AB   ");
  });

  it("truncates when text is wider than target", () => {
    const result = centerInWidth("hello world", 5);
    expect(stripAnsi(result).length).toBeLessThanOrEqual(5);
  });

  it("returns text as-is when exact width", () => {
    expect(centerInWidth("abc", 3)).toBe("abc");
  });
});

// ── WelcomeScreen.render ───────────────────────────────────────────

function makeState(overrides?: Partial<{ model: string; agentId: string; sessionKey: string }>) {
  return {
    sessionInfo: { model: overrides?.model ?? "gpt-4" },
    currentAgentId: overrides?.agentId ?? "default",
    currentSessionKey: overrides?.sessionKey ?? "agent:default:main",
  } as ReturnType<() => import("../tui-types.js").TuiStateAccess>;
}

describe("WelcomeScreen", () => {
  const create = (overrides?: Parameters<typeof makeState>[0]) =>
    new WelcomeScreen({
      version: "0.1.4",
      getState: () => makeState(overrides),
    });

  describe("two-column (width >= 70)", () => {
    it("renders border characters", () => {
      const lines = create().render(100);
      const joined = lines.join("\n");
      const plain = stripAnsi(joined);
      expect(plain).toContain("╭");
      expect(plain).toContain("╯");
    });

    it("contains version in top border", () => {
      const lines = create().render(100);
      const plain = stripAnsi(lines.join("\n"));
      expect(plain).toContain("Mayros v0.1.4");
    });

    it("contains shield block characters", () => {
      const plain = stripAnsi(create().render(100).join("\n"));
      expect(plain).toContain("█");
      expect(plain).toContain("▄");
    });

    it("contains welcome text", () => {
      const plain = stripAnsi(create().render(100).join("\n"));
      expect(plain).toContain("Welcome to Mayros");
    });

    it("shows model and agent", () => {
      const plain = stripAnsi(create({ model: "claude-3" }).render(100).join("\n"));
      expect(plain).toContain("claude-3");
      expect(plain).toContain("agent:default");
    });

    it("shows quick start tips", () => {
      const plain = stripAnsi(create().render(100).join("\n"));
      expect(plain).toContain("/help");
      expect(plain).toContain("/agents");
    });

    it("shows session key", () => {
      const plain = stripAnsi(create({ sessionKey: "agent:coder:dev" }).render(100).join("\n"));
      expect(plain).toContain("agent:coder:dev");
    });
  });

  describe("single-column (width < 70)", () => {
    it("renders without crashing at narrow width", () => {
      const lines = create().render(50);
      expect(lines.length).toBeGreaterThan(5);
    });

    it("contains version and shield", () => {
      const plain = stripAnsi(create().render(60).join("\n"));
      expect(plain).toContain("Mayros v0.1.4");
      expect(plain).toContain("█");
    });

    it("shows tips in single column", () => {
      const plain = stripAnsi(create().render(60).join("\n"));
      expect(plain).toContain("/help");
    });

    it("renders at minimum width (30) without throwing", () => {
      expect(() => create().render(30)).not.toThrow();
    });
  });

  it("invalidate does not throw", () => {
    expect(() => create().invalidate()).not.toThrow();
  });
});
