/* ------------------------------------------------------------------ */
/*  VSCode webview API accessor                                        */
/*                                                                     */
/*  acquireVsCodeApi() is injected by the VSCode webview host and can  */
/*  only be called once. We call it at module load and export the      */
/*  singleton so all webview code shares the same instance.            */
/* ------------------------------------------------------------------ */

type VsCodeApi = {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode: VsCodeApi = acquireVsCodeApi();
