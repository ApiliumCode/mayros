/**
 * code_web_search tool — Search the web and return results.
 *
 * Returns titles, URLs, and snippets for each result.
 * Supports custom search API (SearXNG/Brave) via MAYROS_SEARCH_API_URL
 * and falls back to DuckDuckGo HTML scraping via curl.
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function registerWebSearch(api: MayrosPluginApi, _cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_web_search",
      label: "Web Search",
      description:
        "Search the web and return results. Returns titles, URLs, and snippets for each result.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        max_results: Type.Optional(
          Type.Number({ description: "Maximum number of results to return (default: 5)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { query?: string; max_results?: number };
        if (typeof p.query !== "string" || !p.query.trim()) {
          throw new ToolInputError("query required");
        }

        const query = p.query.trim();
        const maxResults =
          typeof p.max_results === "number"
            ? Math.max(1, Math.min(Math.trunc(p.max_results), 20))
            : 5;

        type SearchResult = { title: string; url: string; snippet: string };
        const results: SearchResult[] = [];

        // Strategy 1: Try MAYROS_SEARCH_API_URL env (SearXNG / Brave / custom)
        const searchApiUrl = process.env.MAYROS_SEARCH_API_URL;
        const searchApiKey = process.env.MAYROS_SEARCH_API_KEY;

        if (searchApiUrl) {
          try {
            const url = new URL(searchApiUrl);
            url.searchParams.set("q", query);
            url.searchParams.set("format", "json");
            url.searchParams.set("count", String(maxResults));

            const headers: Record<string, string> = { "User-Agent": "Mayros/0.1" };
            if (searchApiKey) {
              headers["X-Subscription-Token"] = searchApiKey; // Brave format
              headers["Authorization"] = `Bearer ${searchApiKey}`;
            }

            const resp = await fetch(url.toString(), {
              headers,
              signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
              const data = (await resp.json()) as Record<string, unknown>;
              // SearXNG format
              const searxResults = data.results as
                | Array<{ title?: string; url?: string; content?: string }>
                | undefined;
              if (Array.isArray(searxResults)) {
                for (const r of searxResults.slice(0, maxResults)) {
                  if (r.url) {
                    results.push({
                      title: String(r.title ?? ""),
                      url: String(r.url),
                      snippet: String(r.content ?? ""),
                    });
                  }
                }
              }
              // Brave format
              if (results.length === 0) {
                const webResults = (data.web as Record<string, unknown> | undefined)?.results as
                  | Array<{ title?: string; url?: string; description?: string }>
                  | undefined;
                if (Array.isArray(webResults)) {
                  for (const r of webResults.slice(0, maxResults)) {
                    if (r.url) {
                      results.push({
                        title: String(r.title ?? ""),
                        url: String(r.url),
                        snippet: String(r.description ?? ""),
                      });
                    }
                  }
                }
              }
            }
          } catch {
            // Fall through to DuckDuckGo fallback
          }
        }

        // Strategy 2: DuckDuckGo HTML fallback via curl
        if (results.length === 0) {
          try {
            const encodedQuery = encodeURIComponent(query);
            const { stdout } = await execFileAsync(
              "curl",
              [
                "-s",
                "-L",
                "-A",
                "Mayros/0.1",
                "--max-time",
                "10",
                `https://html.duckduckgo.com/html/?q=${encodedQuery}`,
              ],
              { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
            );

            // Parse DuckDuckGo HTML results
            const resultPattern =
              /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

            const links: Array<{ url: string; title: string }> = [];
            let match: RegExpExecArray | null;
            while ((match = resultPattern.exec(stdout)) !== null) {
              const rawUrl = match[1];
              const title = match[2].replace(/<[^>]*>/g, "").trim();
              // DuckDuckGo wraps URLs in redirect, extract actual URL
              let url = rawUrl;
              const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
              if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1]);
              }
              if (url && title) {
                links.push({ url, title });
              }
            }

            const snippets: string[] = [];
            while ((match = snippetPattern.exec(stdout)) !== null) {
              snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
            }

            for (let i = 0; i < Math.min(links.length, maxResults); i++) {
              results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: snippets[i] ?? "",
              });
            }
          } catch {
            // curl failed — no results
          }
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No results found for: ${query}` }],
            details: { query, resultCount: 0 },
          };
        }

        const text = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text }],
          details: { query, resultCount: results.length },
        };
      },
    },
    { name: "code_web_search" },
  );
}
