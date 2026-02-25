#!/usr/bin/env tsx
/**
 * Cortex Binary Installer (CLI entry point)
 *
 * Thin wrapper around the shared installOrUpdateCortex() function.
 */

import { installOrUpdateCortex } from "../extensions/shared/cortex-update-check.js";

async function main(): Promise<void> {
  console.log("Cortex Binary Installer");
  console.log("=======================\n");

  await installOrUpdateCortex(console.log);

  console.log("\nYou can verify with:");
  console.log("  aingle-cortex --version");
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
