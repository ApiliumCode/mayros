/**
 * Mayros Browser Automation Plugin
 *
 * Registers browser control tools that use Chrome DevTools Protocol (CDP)
 * to automate a running Chrome instance. No Playwright or Puppeteer required.
 *
 * Tools:
 *   browser_navigate   — Navigate browser to a URL and return page info
 *   browser_screenshot  — Take a screenshot of the current browser page
 *   browser_click       — Click an element by CSS selector
 *   browser_evaluate    — Run JavaScript in the browser page and return result
 *
 * Prerequisites:
 *   - Chrome running with --remote-debugging-port=9222
 *   - The `ws` npm package installed
 */

import type { MayrosPluginApi } from "mayros/plugin-sdk";

// ============================================================================
// Plugin Definition
// ============================================================================

const browserAutomationPlugin = {
  id: "browser-automation",
  name: "Browser Automation",
  description: "Automate a running Chrome instance via Chrome DevTools Protocol (CDP)",
  kind: "tool" as const,
  version: "0.1.5",

  async register(api: MayrosPluginApi) {
    api.logger.info("browser-automation: registered");

    // ========================================================================
    // Tool: browser_navigate
    // ========================================================================

    api.registerTool({
      name: "browser_navigate",
      description: "Navigate browser to a URL and return page info",
      parameters: {
        type: "object" as const,
        properties: {
          url: { type: "string" as const, description: "URL to navigate to" },
        },
        required: ["url"],
      },
      execute: async (args: Record<string, unknown>) => {
        const { BrowserClient } = await import("./browser-client.js");
        const client = new BrowserClient();
        await client.connect();
        try {
          const result = await client.navigate(args.url as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } finally {
          await client.disconnect();
        }
      },
    });

    // ========================================================================
    // Tool: browser_screenshot
    // ========================================================================

    api.registerTool({
      name: "browser_screenshot",
      description: "Take a screenshot of the current browser page",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      execute: async () => {
        const { BrowserClient } = await import("./browser-client.js");
        const client = new BrowserClient();
        await client.connect();
        try {
          const result = await client.screenshot();
          return {
            content: [
              {
                type: "image" as const,
                mimeType: `image/${result.format}`,
                bytes: result.data.length,
              },
              { type: "text" as const, text: `Screenshot: ${result.width}x${result.height}` },
            ],
          };
        } finally {
          await client.disconnect();
        }
      },
    });

    // ========================================================================
    // Tool: browser_click
    // ========================================================================

    api.registerTool({
      name: "browser_click",
      description: "Click an element by CSS selector",
      parameters: {
        type: "object" as const,
        properties: {
          selector: { type: "string" as const, description: "CSS selector" },
        },
        required: ["selector"],
      },
      execute: async (args: Record<string, unknown>) => {
        const { BrowserClient } = await import("./browser-client.js");
        const client = new BrowserClient();
        await client.connect();
        try {
          await client.click(args.selector as string);
          return { content: [{ type: "text" as const, text: `Clicked: ${args.selector}` }] };
        } finally {
          await client.disconnect();
        }
      },
    });

    // ========================================================================
    // Tool: browser_evaluate
    // ========================================================================

    api.registerTool({
      name: "browser_evaluate",
      description: "Run JavaScript in the browser page and return result",
      parameters: {
        type: "object" as const,
        properties: {
          expression: { type: "string" as const, description: "JavaScript expression" },
        },
        required: ["expression"],
      },
      execute: async (args: Record<string, unknown>) => {
        const { BrowserClient } = await import("./browser-client.js");
        const client = new BrowserClient();
        await client.connect();
        try {
          const result = await client.evaluate(args.expression as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } finally {
          await client.disconnect();
        }
      },
    });
  },
};

export default browserAutomationPlugin;
