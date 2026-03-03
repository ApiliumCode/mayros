import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

/** Extension host bundle (CJS, Node) */
const extensionConfig = {
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
const webviewEntries = [
  "src/webview/chat/chat.ts",
  "src/webview/plan/plan.ts",
  "src/webview/trace/trace.ts",
  "src/webview/kg/kg.ts",
];

const webviewConfig = {
  entryPoints: webviewEntries,
  bundle: true,
  outdir: "dist/webview",
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
};

async function build() {
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

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
