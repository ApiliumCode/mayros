/**
 * Cortex Lifecycle Callback Registry
 *
 * Bridges the plugin layer (memory-semantic owns the sidecar) with the
 * infra layer (update-runner needs to stop/start the sidecar during
 * binary replacement). The plugin registers callbacks at load time;
 * update-runner reads them when performing a Cortex binary update.
 */

const REGISTRY_KEY = Symbol.for("mayros.cortexLifecycleCallbacks");

export type CortexLifecycleCallbacks = {
  /** Called after download but before replacing the binary on disk. */
  onBeforeReplace: () => Promise<void>;
  /** Called after the new binary is in place. */
  onAfterReplace: () => Promise<void>;
  /** Host where Cortex is listening (for flush). */
  host: string;
  /** Port where Cortex is listening (for flush). */
  port: number;
};

type GlobalWithCallbacks = typeof globalThis & {
  [REGISTRY_KEY]?: CortexLifecycleCallbacks | null;
};

/**
 * Register lifecycle callbacks. Called by the memory-semantic plugin
 * during service start so update-runner can coordinate sidecar restarts.
 */
export function registerCortexLifecycleCallbacks(callbacks: CortexLifecycleCallbacks): void {
  (globalThis as GlobalWithCallbacks)[REGISTRY_KEY] = callbacks;
}

/**
 * Retrieve the registered lifecycle callbacks, or null if no plugin
 * has registered (e.g. memory-semantic is not loaded).
 */
export function getCortexLifecycleCallbacks(): CortexLifecycleCallbacks | null {
  return (globalThis as GlobalWithCallbacks)[REGISTRY_KEY] ?? null;
}

/**
 * Clear the registered callbacks. Called by the memory-semantic plugin
 * during service stop.
 */
export function clearCortexLifecycleCallbacks(): void {
  (globalThis as GlobalWithCallbacks)[REGISTRY_KEY] = null;
}
