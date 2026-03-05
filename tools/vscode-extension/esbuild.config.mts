import * as esbuild from "esbuild";
import type { BuildOptions } from "esbuild";

const isWatch: boolean = process.argv.includes("--watch");

/** Extension host bundle (CJS, Node) */
const extensionConfig: BuildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
};

/** Webview bundles (ESM, browser) */
const webviewEntries: string[] = [
  "src/webview/chat/chat.ts",
  "src/webview/plan/plan.ts",
  "src/webview/trace/trace.ts",
  "src/webview/kg/kg.ts",
];

const webviewConfig: BuildOptions = {
  entryPoints: webviewEntries,
  bundle: true,
  outdir: "dist/webview",
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  loader: { ".css": "text" },
};

async function build(): Promise<void> {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(webviewConfig);
    console.log("Build complete.");
  }
}

build().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
