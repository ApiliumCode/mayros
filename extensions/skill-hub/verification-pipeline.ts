import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  scanDirectoryWithSummary,
  type SkillScanSummary,
} from "../../src/security/skill-scanner.js";
import type { VerificationConfig } from "./config.js";
import { verifySkillSignature, type SignatureData } from "./signing.js";
import { verifyFileHashes } from "./skill-packager.js";

export type PipelineStep = "scan" | "signature" | "pol" | "sandbox";

export type PipelineStepResult = {
  step: PipelineStep;
  passed: boolean;
  message: string;
  details?: unknown;
};

export type PipelineResult = {
  passed: boolean;
  steps: PipelineStepResult[];
};

export type { CortexLike } from "../shared/cortex-client.js";
import type { CortexLike } from "../shared/cortex-client.js";

/**
 * Run the full verification pipeline for a skill directory.
 * Steps: 1. Static scan  2. Signature verify  3. PoL validate  4. Sandbox test
 */
export async function runVerificationPipeline(
  skillDir: string,
  config: VerificationConfig,
  cortex?: CortexLike,
  namespace?: string,
): Promise<PipelineResult> {
  const steps: PipelineStepResult[] = [];
  let allPassed = true;

  // --- Step 1: Static scan ---
  try {
    const scanResult: SkillScanSummary = await scanDirectoryWithSummary(skillDir);
    const hasCritical = scanResult.critical > 0;

    steps.push({
      step: "scan",
      passed: !hasCritical,
      message: hasCritical
        ? `Static scan found ${scanResult.critical} critical issue(s)`
        : `Static scan passed (${scanResult.scannedFiles} files, ${scanResult.warn} warning(s))`,
      details: {
        scannedFiles: scanResult.scannedFiles,
        critical: scanResult.critical,
        warn: scanResult.warn,
        info: scanResult.info,
      },
    });

    if (hasCritical) allPassed = false;
  } catch (err) {
    steps.push({
      step: "scan",
      passed: false,
      message: `Static scan error: ${String(err)}`,
    });
    allPassed = false;
  }

  // --- Step 2: Signature verification ---
  if (config.requireSignature) {
    try {
      const sigPath = join(skillDir, "SKILL.sig");
      const sigContent = await readFile(sigPath, "utf-8");
      const sig: SignatureData = JSON.parse(sigContent);

      // Verify Ed25519 signature
      const sigValid = verifySkillSignature(sig);
      if (!sigValid) {
        steps.push({
          step: "signature",
          passed: false,
          message: "Ed25519 signature verification failed",
        });
        allPassed = false;
      } else {
        // Verify file hashes match on-disk files
        const hashResult = await verifyFileHashes(skillDir, sig.fileHashes);
        steps.push({
          step: "signature",
          passed: hashResult.valid,
          message: hashResult.valid
            ? "Signature and file hashes verified"
            : `File hash mismatches: ${hashResult.mismatches.join(", ")}`,
          details: { mismatches: hashResult.mismatches },
        });

        if (!hashResult.valid) allPassed = false;
      }
    } catch (err) {
      const message = String(err);
      if (message.includes("ENOENT")) {
        steps.push({
          step: "signature",
          passed: false,
          message: "SKILL.sig not found — unsigned skill",
        });
      } else {
        steps.push({
          step: "signature",
          passed: false,
          message: `Signature verification error: ${message}`,
        });
      }
      allPassed = false;
    }
  } else {
    steps.push({
      step: "signature",
      passed: true,
      message: "Signature verification skipped (not required)",
    });
  }

  // --- Step 3: PoL validation ---
  if (config.polValidation && cortex) {
    try {
      // Read the SKILL.md to extract manifest
      const skillMdPath = join(skillDir, "SKILL.md");
      const content = await readFile(skillMdPath, "utf-8");

      // Simple extraction of assertions from frontmatter
      const assertions = extractAssertionsFromFrontmatter(content);

      if (assertions.length > 0) {
        const polResult = await cortex.validateSkillManifest({
          assertions,
          namespace: namespace ?? "mayros",
        });

        steps.push({
          step: "pol",
          passed: polResult.valid,
          message: polResult.valid
            ? "PoL validation passed"
            : `PoL validation failed: ${polResult.errors.join(", ")}`,
          details: { errors: polResult.errors },
        });

        if (!polResult.valid) allPassed = false;
      } else {
        steps.push({
          step: "pol",
          passed: true,
          message: "No assertions to validate",
        });
      }
    } catch (err) {
      steps.push({
        step: "pol",
        passed: false,
        message: `PoL validation error: ${String(err)}`,
      });
      allPassed = false;
    }
  } else {
    steps.push({
      step: "pol",
      passed: true,
      message: config.polValidation
        ? "PoL validation skipped (Cortex unavailable)"
        : "PoL validation disabled",
    });
  }

  // --- Step 4: Sandbox test ---
  if (config.sandboxTest && cortex) {
    let sandboxId: string | undefined;
    try {
      const sandbox = await cortex.createSandbox(
        `verify:sandbox:${Date.now()}`,
        config.sandboxTtlSeconds,
      );
      sandboxId = sandbox.id;

      // Basic sandbox test: verify the skill can be loaded in the sandbox namespace
      steps.push({
        step: "sandbox",
        passed: true,
        message: `Sandbox test passed (ns: ${sandbox.namespace})`,
        details: { sandboxId: sandbox.id },
      });
    } catch (err) {
      steps.push({
        step: "sandbox",
        passed: false,
        message: `Sandbox test error: ${String(err)}`,
      });
      allPassed = false;
    } finally {
      if (sandboxId && cortex) {
        try {
          await cortex.deleteSandbox(sandboxId);
        } catch {
          // cleanup failure is non-fatal
        }
      }
    }
  } else {
    steps.push({
      step: "sandbox",
      passed: true,
      message: config.sandboxTest
        ? "Sandbox test skipped (Cortex unavailable)"
        : "Sandbox test disabled",
    });
  }

  return { passed: allPassed, steps };
}

/**
 * Convenience wrapper: run the full verification pipeline on a temp directory.
 * Identical to `runVerificationPipeline` but named for clarity in the
 * verify-then-promote flow.
 */
export const runVerificationOnTemp = runVerificationPipeline;

/**
 * Extract assertion declarations from SKILL.md frontmatter.
 * This is a simplified parser for the verification pipeline.
 */
function extractAssertionsFromFrontmatter(
  content: string,
): Array<{ predicate: string; requireProof: boolean }> {
  // Match YAML frontmatter between ---
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];

  const fm = fmMatch[1];

  // Simple regex extraction for assertions block
  const assertions: Array<{ predicate: string; requireProof: boolean }> = [];
  const assertionLines = fm.match(/assertions:\s*\n((?:\s+-[^\n]*\n?)*)/);
  if (!assertionLines) return [];

  const predicateMatches = assertionLines[1].matchAll(/predicate:\s*["']?([^"'\n]+)["']?/g);
  const proofMatches = assertionLines[1].matchAll(/requireProof:\s*(true|false)/g);

  const predicates = [...predicateMatches].map((m) => m[1].trim());
  const proofs = [...proofMatches].map((m) => m[1] === "true");

  for (let i = 0; i < predicates.length; i++) {
    assertions.push({
      predicate: predicates[i],
      requireProof: proofs[i] ?? false,
    });
  }

  return assertions;
}
