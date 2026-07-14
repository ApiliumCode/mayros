import {
  type KeybindingsConfig,
  KeybindingsManager,
  type KeyId,
  matchesKey,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";

export type TuiAction =
  | "selectAgent"
  | "selectModel"
  | "selectSession"
  | "toggleTools"
  | "toggleThinking";

export const DEFAULT_TUI_KEYBINDINGS: Record<TuiAction, KeyId> = {
  selectAgent: "ctrl+g",
  selectModel: "ctrl+l",
  selectSession: "ctrl+p",
  toggleTools: "ctrl+o",
  toggleThinking: "ctrl+t",
};

export class TuiKeybindingResolver {
  private bindings: Map<TuiAction, KeyId[]>;

  constructor(overrides?: Record<string, string | string[]>) {
    this.bindings = new Map();
    for (const [action, defaultKey] of Object.entries(DEFAULT_TUI_KEYBINDINGS)) {
      const tuiAction = action as TuiAction;
      const override = overrides?.[action];
      if (override) {
        const keys = Array.isArray(override) ? override : [override];
        this.bindings.set(
          tuiAction,
          keys.map((k) => k as KeyId),
        );
      } else {
        this.bindings.set(tuiAction, [defaultKey]);
      }
    }
  }

  matches(data: string, action: TuiAction): boolean {
    const keys = this.bindings.get(action);
    if (!keys) {
      return false;
    }
    return keys.some((key) => matchesKey(data, key));
  }

  getKeys(action: TuiAction): KeyId[] {
    return this.bindings.get(action) ?? [];
  }
}

export function applyKeybindingsFromConfig(
  config?: Record<string, string | string[]>,
): KeybindingsManager {
  const editorConfig: KeybindingsConfig = {};
  if (config) {
    for (const [action, keys] of Object.entries(config)) {
      if (action in DEFAULT_TUI_KEYBINDINGS) {
        continue;
      }
      (editorConfig as Record<string, KeyId | KeyId[]>)[action] = Array.isArray(keys)
        ? (keys as KeyId[])
        : (keys as KeyId);
    }
  }
  const manager = new KeybindingsManager(TUI_KEYBINDINGS, editorConfig);
  setKeybindings(manager);
  return manager;
}

export function createTuiResolver(
  config?: Record<string, string | string[]>,
): TuiKeybindingResolver {
  return new TuiKeybindingResolver(config);
}
