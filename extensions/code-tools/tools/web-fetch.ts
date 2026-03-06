/**
 * code_web_fetch tool — Fetch a URL and return its content as text.
 *
 * HTML pages are converted to readable text using a lightweight built-in converter.
 * Includes SSRF protection (blocks private/internal addresses) and auto-upgrades
 * HTTP to HTTPS.
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";

// ============================================================================
// Lightweight HTML-to-text conversion (no external dependency)
// ============================================================================

function htmlToText(html: string): string {
  let text = html;
  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Convert common elements
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "- ");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");
  // Extract link text with URL
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const clean = (linkText as string).replace(/<[^>]*>/g, "").trim();
    return clean === href ? clean : `${clean} (${href})`;
  });
  // Bold/italic
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_");
  // Code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  // Strip remaining tags
  text = text.replace(/<[^>]*>/g, "");
  // Decode entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]*>/g, "").trim() : "";
}

// ============================================================================
// SSRF blocklist
// ============================================================================

const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  ".local",
  ".internal",
  "metadata.google.internal",
  "169.254.169.254",
];

// ============================================================================
// Tool registration
// ============================================================================

export function registerWebFetch(api: MayrosPluginApi, _cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_web_fetch",
      label: "Web Fetch",
      description:
        "Fetch a URL and return its content as text. HTML pages are converted to readable text. If a prompt is provided, it is included as a hint for the content.",
      parameters: Type.Object({
        url: Type.String({ description: "URL to fetch" }),
        prompt: Type.Optional(
          Type.String({ description: "Prompt describing what information to extract" }),
        ),
        max_length: Type.Optional(
          Type.Number({ description: "Maximum content length in characters (default: 50000)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { url?: string; prompt?: string; max_length?: number };
        if (typeof p.url !== "string" || !p.url.trim()) {
          throw new ToolInputError("url required");
        }

        let url = p.url.trim();
        // Auto-upgrade http to https
        if (url.startsWith("http://")) {
          url = url.replace("http://", "https://");
        }
        if (!url.startsWith("https://")) {
          url = `https://${url}`;
        }

        // Validate URL
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new ToolInputError(`Invalid URL: ${url}`);
        }

        // Block private/internal URLs (SSRF protection)
        const hostname = parsedUrl.hostname.toLowerCase();
        for (const pattern of BLOCKED_HOSTNAMES) {
          if (hostname === pattern || hostname.endsWith(pattern)) {
            throw new ToolInputError(`Blocked URL: ${url} (private/internal address)`);
          }
        }

        const maxLength =
          typeof p.max_length === "number"
            ? Math.max(1000, Math.min(Math.trunc(p.max_length), 200000))
            : 50000;

        let responseText: string;
        let finalUrl = url;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);

          const resp = await fetch(url, {
            headers: {
              "User-Agent": "Mayros/0.1 (Web Fetch Tool)",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            },
            redirect: "follow",
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!resp.ok) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `HTTP ${resp.status} ${resp.statusText} for ${url}`,
                },
              ],
              details: { url, status: resp.status },
            };
          }

          finalUrl = resp.url;
          responseText = await resp.text();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Fetch failed for ${url}: ${message}` }],
            details: { url, error: message },
          };
        }

        // Convert HTML to text
        const title = extractTitle(responseText);
        let content: string;

        if (responseText.trimStart().startsWith("<")) {
          content = htmlToText(responseText);
        } else {
          content = responseText;
        }

        // Truncate
        const truncated = content.length > maxLength;
        if (truncated) {
          content = content.slice(0, maxLength) + "\n\n[Content truncated]";
        }

        // Build output
        const parts: string[] = [];
        if (title) {
          parts.push(`Title: ${title}`);
        }
        parts.push(`URL: ${finalUrl}`);
        if (p.prompt) {
          parts.push(`\nPrompt: ${p.prompt}`);
        }
        parts.push(`\n${content}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
          details: {
            url: finalUrl,
            title,
            contentLength: content.length,
            truncated,
          },
        };
      },
    },
    { name: "code_web_fetch" },
  );
}
