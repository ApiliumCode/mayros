/**
 * Browser Automation Client
 *
 * Lightweight browser automation via Chrome DevTools Protocol (CDP).
 * Connects to a running Chrome instance with --remote-debugging-port.
 * Does NOT bundle Playwright or Puppeteer — uses CDP directly over WebSocket.
 *
 * Usage:
 *   Start Chrome with: google-chrome --remote-debugging-port=9222
 *   Then connect:
 *     const client = new BrowserClient();
 *     await client.connect();
 *     await client.navigate("https://example.com");
 *     const shot = await client.screenshot();
 *     await client.disconnect();
 */

// ============================================================================
// Types
// ============================================================================

export type BrowserConfig = {
  cdpUrl: string;
  screenshotFormat: "png" | "jpeg";
  defaultTimeout: number;
};

export type BrowserPage = {
  id: string;
  url: string;
  title: string;
};

export type ScreenshotResult = {
  data: string;
  format: "png" | "jpeg";
  width: number;
  height: number;
};

export type NavigateResult = {
  url: string;
  title: string;
  status: number;
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: BrowserConfig = {
  cdpUrl: "http://localhost:9222",
  screenshotFormat: "png",
  defaultTimeout: 30_000,
};

// ============================================================================
// CDP Response Types
// ============================================================================

type CdpVersionResponse = {
  webSocketDebuggerUrl: string;
};

type CdpPageEntry = {
  id: string;
  url: string;
  title: string;
  type: string;
};

type CdpMessage = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

// ============================================================================
// BrowserClient
// ============================================================================

export class BrowserClient {
  private config: BrowserConfig;
  private ws: import("ws").WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();

  constructor(config?: Partial<BrowserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Connect to Chrome via CDP.
   * Fetches the WebSocket debugger URL from the CDP endpoint, then opens
   * a persistent WebSocket connection.
   */
  async connect(): Promise<void> {
    const versionUrl = `${this.config.cdpUrl}/json/version`;

    const response = await fetch(versionUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to connect to Chrome DevTools at ${versionUrl} (HTTP ${response.status}). ` +
          "Ensure Chrome is running with --remote-debugging-port.",
      );
    }

    const version = (await response.json()) as CdpVersionResponse;
    const wsUrl = version.webSocketDebuggerUrl;

    if (!wsUrl) {
      throw new Error("Chrome DevTools did not return a webSocketDebuggerUrl.");
    }

    const WebSocketModule = await loadWsModule();
    this.ws = new WebSocketModule(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket connection timed out after ${this.config.defaultTimeout}ms`));
      }, this.config.defaultTimeout);

      ws.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket connection failed: ${err.message}`));
      });

      ws.on("message", (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(String(raw)) as CdpMessage;
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const handler = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(`CDP error: ${msg.error.message}`));
            } else {
              handler.resolve(msg.result ?? {});
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });
  }

  /**
   * Disconnect from Chrome.
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pending.clear();
  }

  /**
   * List open pages/tabs.
   */
  async listPages(): Promise<BrowserPage[]> {
    const listUrl = `${this.config.cdpUrl}/json/list`;
    const response = await fetch(listUrl);
    if (!response.ok) {
      throw new Error(`Failed to list pages (HTTP ${response.status})`);
    }
    const entries = (await response.json()) as CdpPageEntry[];
    return entries
      .filter((entry) => entry.type === "page")
      .map((entry) => ({
        id: entry.id,
        url: entry.url,
        title: entry.title,
      }));
  }

  /**
   * Navigate to URL.
   */
  async navigate(url: string): Promise<NavigateResult> {
    const result = (await this.sendCommand("Page.navigate", { url })) as Record<string, unknown>;
    // Get page info after navigation
    const evalResult = (await this.sendCommand("Runtime.evaluate", {
      expression: "JSON.stringify({ title: document.title, url: location.href })",
      returnByValue: true,
    })) as { result: { value: string } };

    let title = "";
    let finalUrl = url;
    try {
      const info = JSON.parse(evalResult.result.value) as { title: string; url: string };
      title = info.title;
      finalUrl = info.url;
    } catch {
      // Use defaults
    }

    return {
      url: finalUrl,
      title,
      status: typeof result.errorText === "string" ? 0 : 200,
    };
  }

  /**
   * Take screenshot of current page.
   */
  async screenshot(): Promise<ScreenshotResult> {
    const result = (await this.sendCommand("Page.captureScreenshot", {
      format: this.config.screenshotFormat,
      quality: this.config.screenshotFormat === "jpeg" ? 80 : undefined,
    })) as { data: string };

    // Get viewport dimensions
    const layoutResult = (await this.sendCommand("Page.getLayoutMetrics")) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number };
    };

    const width = layoutResult.cssVisualViewport?.clientWidth ?? 1280;
    const height = layoutResult.cssVisualViewport?.clientHeight ?? 720;

    return {
      data: result.data,
      format: this.config.screenshotFormat,
      width,
      height,
    };
  }

  /**
   * Click element by CSS selector.
   */
  async click(selector: string): Promise<void> {
    const escapedSelector = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const result = (await this.sendCommand("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('${escapedSelector}');
        if (!el) throw new Error('Element not found: ${escapedSelector}');
        el.click();
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: false,
    })) as { result: { value: unknown }; exceptionDetails?: { text: string } };

    if (result.exceptionDetails) {
      throw new Error(`Click failed: ${result.exceptionDetails.text}`);
    }
  }

  /**
   * Type text into focused element.
   * Dispatches individual key events for each character.
   */
  async type(text: string): Promise<void> {
    for (const char of text) {
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        key: char,
        unmodifiedText: char,
      });
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: char,
      });
    }
  }

  /**
   * Evaluate JavaScript in page context.
   */
  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value: unknown }; exceptionDetails?: { text: string } };

    if (result.exceptionDetails) {
      throw new Error(`Evaluate failed: ${result.exceptionDetails.text}`);
    }

    return result.result.value;
  }

  /**
   * Get page HTML content.
   */
  async getContent(): Promise<string> {
    const result = (await this.sendCommand("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    })) as { result: { value: string } };

    return result.result.value;
  }

  /**
   * Send a CDP command over WebSocket.
   * Returns a promise that resolves with the command result.
   */
  private async sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) {
      throw new Error("Not connected. Call connect() first.");
    }

    const id = ++this.messageId;
    const message = JSON.stringify({ id, method, params: params ?? {} });

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${this.config.defaultTimeout}ms`));
      }, this.config.defaultTimeout);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.ws!.send(message);
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Dynamically load the `ws` WebSocket module.
 * Throws a clear error if the package is not installed.
 */
async function loadWsModule(): Promise<typeof import("ws").WebSocket> {
  try {
    const mod = await import("ws");
    return mod.default || mod.WebSocket;
  } catch {
    throw new Error("Browser automation requires the 'ws' package. Run: npm install ws");
  }
}
