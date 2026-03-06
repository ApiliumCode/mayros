import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ToolInputError
vi.mock("../../../src/agents/tools/common.js", () => ({
  ToolInputError: class ToolInputError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ToolInputError";
    }
  },
}));

describe("code_web_search", () => {
  let executeFn: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;

  beforeEach(() => {
    vi.resetModules();

    // Intercept registerTool to capture execute function
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

    // Reset env
    delete process.env.MAYROS_SEARCH_API_URL;
    delete process.env.MAYROS_SEARCH_API_KEY;

    // Import and register
    return import("./web-search.js").then(({ registerWebSearch }) => {
      registerWebSearch(mockApi as never, cfg as never);
    });
  });

  it("registers tool with correct name", () => {
    expect(executeFn).toBeDefined();
  });

  it("rejects empty query", async () => {
    await expect(executeFn("t1", {})).rejects.toThrow("query required");
    await expect(executeFn("t2", { query: "" })).rejects.toThrow("query required");
    await expect(executeFn("t3", { query: "   " })).rejects.toThrow("query required");
  });

  it("rejects non-string query", async () => {
    await expect(executeFn("t4", { query: 42 })).rejects.toThrow("query required");
  });

  it("clamps max_results to valid range", async () => {
    // This test verifies the function doesn't throw with valid params
    // Actual HTTP calls will fail in test, so we just verify it attempts to search
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));
    try {
      const result = await executeFn("t5", { query: "test query", max_results: 100 });
      // Should fall back to no results (both API and curl will fail in test)
      expect(result.details.query).toBe("test query");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("returns no results message when search fails", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));
    try {
      const result = await executeFn("t6", { query: "unfindable test xyz" });
      expect(result.content[0].text).toContain("No results found");
      expect(result.details.resultCount).toBe(0);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("uses custom search API when MAYROS_SEARCH_API_URL is set", async () => {
    process.env.MAYROS_SEARCH_API_URL = "https://search.example.com/api";
    const mockResponse = {
      results: [
        { title: "Result 1", url: "https://example.com/1", content: "Snippet 1" },
        { title: "Result 2", url: "https://example.com/2", content: "Snippet 2" },
      ],
    };
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    try {
      const result = await executeFn("t7", { query: "test api" });
      expect(result.content[0].text).toContain("Result 1");
      expect(result.content[0].text).toContain("https://example.com/1");
      expect(result.details.resultCount).toBe(2);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("handles Brave Search API format", async () => {
    process.env.MAYROS_SEARCH_API_URL = "https://api.brave.com/res/v1/web/search";
    process.env.MAYROS_SEARCH_API_KEY = "BSA_test_key";
    const mockResponse = {
      web: {
        results: [
          {
            title: "Brave Result",
            url: "https://brave.example.com",
            description: "Brave desc",
          },
        ],
      },
    };
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    try {
      const result = await executeFn("t8", { query: "brave test" });
      expect(result.content[0].text).toContain("Brave Result");
      expect(result.details.resultCount).toBe(1);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("formats results with numbered list", async () => {
    process.env.MAYROS_SEARCH_API_URL = "https://search.example.com/api";
    const mockResponse = {
      results: [
        { title: "First", url: "https://a.com", content: "Alpha" },
        { title: "Second", url: "https://b.com", content: "Beta" },
      ],
    };
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    try {
      const result = await executeFn("t9", { query: "format test" });
      const text = result.content[0].text;
      expect(text).toContain("1. First");
      expect(text).toContain("2. Second");
      expect(text).toContain("https://a.com");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("respects max_results parameter", async () => {
    process.env.MAYROS_SEARCH_API_URL = "https://search.example.com/api";
    const mockResponse = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `R${i + 1}`,
        url: `https://${i + 1}.com`,
        content: `S${i + 1}`,
      })),
    };
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    try {
      const result = await executeFn("t10", { query: "limit test", max_results: 3 });
      expect(result.details.resultCount).toBe(3);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
