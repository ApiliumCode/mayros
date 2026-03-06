import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/agents/tools/common.js", () => ({
  ToolInputError: class ToolInputError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ToolInputError";
    }
  },
}));

describe("code_web_fetch", () => {
  let executeFn: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;

  beforeEach(async () => {
    vi.resetModules();
    const mockApi = {
      registerTool: vi.fn((toolDef: { execute: typeof executeFn }) => {
        executeFn = toolDef.execute;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const cfg = {
      workspaceRoot: "/tmp/test",
      shellEnabled: true,
      shellTimeout: 120000,
    };
    const { registerWebFetch } = await import("./web-fetch.js");
    registerWebFetch(mockApi as never, cfg as never);
  });

  it("registers tool with correct name", () => {
    expect(executeFn).toBeDefined();
  });

  it("rejects empty url", async () => {
    await expect(executeFn("t1", {})).rejects.toThrow("url required");
    await expect(executeFn("t2", { url: "" })).rejects.toThrow("url required");
    await expect(executeFn("t3", { url: "   " })).rejects.toThrow("url required");
  });

  it("rejects invalid url", async () => {
    await expect(executeFn("t4", { url: "not a url here ::::" })).rejects.toThrow("Invalid URL");
  });

  it("blocks localhost URLs", async () => {
    await expect(executeFn("t5", { url: "https://localhost/secret" })).rejects.toThrow(
      "Blocked URL",
    );
    await expect(executeFn("t6", { url: "https://127.0.0.1/admin" })).rejects.toThrow(
      "Blocked URL",
    );
  });

  it("blocks metadata URLs", async () => {
    await expect(executeFn("t7", { url: "https://169.254.169.254/latest" })).rejects.toThrow(
      "Blocked URL",
    );
    await expect(executeFn("t8", { url: "https://metadata.google.internal/v1" })).rejects.toThrow(
      "Blocked URL",
    );
  });

  it("auto-upgrades http to https", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve("<html><title>Test</title><body>Hello</body></html>"),
    });
    try {
      const result = await executeFn("t9", { url: "http://example.com" });
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "https://example.com",
      );
      expect(result.details.url).toBe("https://example.com");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("converts HTML to readable text", async () => {
    const html = `<html><head><title>Test Page</title></head><body>
      <h1>Header</h1>
      <p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>
      <ul><li>Item 1</li><li>Item 2</li></ul>
    </body></html>`;
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve(html),
    });
    try {
      const result = await executeFn("t10", { url: "https://example.com" });
      const text = result.content[0].text;
      expect(text).toContain("Title: Test Page");
      expect(text).toContain("Header");
      expect(text).toContain("**bold**");
      expect(text).toContain("_italic_");
      expect(text).toContain("- Item 1");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("includes prompt when provided", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve("plain text content"),
    });
    try {
      const result = await executeFn("t11", {
        url: "https://example.com",
        prompt: "Extract the API docs",
      });
      expect(result.content[0].text).toContain("Prompt: Extract the API docs");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("truncates content at max_length", async () => {
    const longContent = "A".repeat(100000);
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve(longContent),
    });
    try {
      const result = await executeFn("t12", { url: "https://example.com", max_length: 5000 });
      expect(result.content[0].text).toContain("[Content truncated]");
      expect(result.details.truncated).toBe(true);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("handles HTTP errors gracefully", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    try {
      const result = await executeFn("t13", { url: "https://example.com/missing" });
      expect(result.content[0].text).toContain("404");
      expect(result.details.status).toBe(404);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("handles fetch failures gracefully", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    try {
      const result = await executeFn("t14", { url: "https://unreachable.example.com" });
      expect(result.content[0].text).toContain("Fetch failed");
      expect(result.content[0].text).toContain("ECONNREFUSED");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("adds https:// prefix when missing", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve("OK"),
    });
    try {
      await executeFn("t15", { url: "example.com" });
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "https://example.com",
      );
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("strips script and style tags from HTML", async () => {
    const html = `<html><head><script>alert('xss')</script><style>.x{color:red}</style></head>
      <body><p>Clean content</p></body></html>`;
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com",
      text: () => Promise.resolve(html),
    });
    try {
      const result = await executeFn("t16", { url: "https://example.com" });
      const text = result.content[0].text;
      expect(text).not.toContain("alert");
      expect(text).not.toContain("color:red");
      expect(text).toContain("Clean content");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
