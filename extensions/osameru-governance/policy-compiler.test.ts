import { describe, it, expect } from "vitest";
import { PolicyCompiler } from "./policy-compiler.js";

describe("PolicyCompiler", () => {
  it("parses DENY rules from markdown", () => {
    const content = `# Policies\n\n- DENY: tool = rm, rmdir\n- ALLOW: tool = ls, cat\n`;
    const compiler = new PolicyCompiler();
    const bundle = compiler.compile([{ path: "MAYROS.md", content }]);
    expect(bundle.rules.length).toBe(2);
    expect(bundle.rules[0]!.action).toBe("deny");
    expect(bundle.rules[0]!.toolPatterns).toEqual(["rm", "rmdir"]);
  });

  it("parses Security section", () => {
    const content = `# Security\n\n- DENY: command = curl *, wget *\n`;
    const compiler = new PolicyCompiler();
    const bundle = compiler.compile([{ path: "MAYROS.md", content }]);
    expect(bundle.rules.length).toBe(1);
    expect(bundle.rules[0]!.commandPatterns).toEqual(["curl *", "wget *"]);
  });

  it("parses JSON code blocks", () => {
    const content =
      '# Policies\n\n```json\n[{"category":"tool","action":"deny","toolPatterns":["dangerous_tool"]}]\n```\n';
    const compiler = new PolicyCompiler();
    const bundle = compiler.compile([{ path: "MAYROS.md", content }]);
    expect(bundle.rules.length).toBe(1);
    expect(bundle.rules[0]!.toolPatterns).toEqual(["dangerous_tool"]);
  });

  it("returns empty bundle for no policy content", () => {
    const compiler = new PolicyCompiler();
    const bundle = compiler.compile([{ path: "MAYROS.md", content: "# README\n\nHello world" }]);
    expect(bundle.rules.length).toBe(0);
  });

  it("sorts rules by priority (deny > require-approval > allow)", () => {
    const content = `# Policies\n\n- ALLOW: tool = safe\n- DENY: tool = bad\n- REQUIRE-APPROVAL: tool = risky\n`;
    const compiler = new PolicyCompiler();
    const bundle = compiler.compile([{ path: "test", content }]);
    expect(bundle.rules[0]!.action).toBe("deny");
    expect(bundle.rules[1]!.action).toBe("require-approval");
    expect(bundle.rules[2]!.action).toBe("allow");
  });
});
