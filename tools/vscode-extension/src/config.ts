import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Extension configuration                                            */
/* ------------------------------------------------------------------ */

export type MayrosExtensionConfig = {
  gatewayUrl: string;
  autoConnect: boolean;
  reconnectDelayMs: number;
  maxReconnectAttempts: number;
};

const DEFAULTS: Readonly<MayrosExtensionConfig> = {
  gatewayUrl: "ws://127.0.0.1:18789",
  autoConnect: true,
  reconnectDelayMs: 3000,
  maxReconnectAttempts: 5,
};

/**
 * Read current Mayros extension settings from workspace configuration.
 * Falls back to defaults for any missing values.
 */
export function getConfig(): MayrosExtensionConfig {
  const config = vscode.workspace.getConfiguration("mayros");
  return {
    gatewayUrl: config.get<string>("gatewayUrl", DEFAULTS.gatewayUrl),
    autoConnect: config.get<boolean>("autoConnect", DEFAULTS.autoConnect),
    reconnectDelayMs: config.get<number>("reconnectDelayMs", DEFAULTS.reconnectDelayMs),
    maxReconnectAttempts: config.get<number>("maxReconnectAttempts", DEFAULTS.maxReconnectAttempts),
  };
}

/**
 * Subscribe to configuration changes that affect the `mayros.*` namespace.
 * Returns a disposable that should be added to `context.subscriptions`.
 */
export function onConfigChange(
  callback: (config: MayrosExtensionConfig) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("mayros")) {
      callback(getConfig());
    }
  });
}

/**
 * Validate a gateway URL. Returns an error message or undefined if valid.
 */
export function validateGatewayUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return "Gateway URL must use ws:// or wss:// protocol";
    }
    return undefined;
  } catch {
    return "Invalid gateway URL format";
  }
}
