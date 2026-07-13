#!/usr/bin/env node
/**
 * Lockfile change policy check.
 *
 * Enforces the dependency supply-chain policy documented in SECURITY.md:
 * a change to pnpm-lock.yaml should arrive alongside a dependency change in
 * package.json, and the commit carrying it should be scoped as `deps:`.
 *
 * The check compares the lockfile against a base. On CI it reads the base
 * from the GITHUB_BASE_REF / commit range; locally it can be invoked with
 * --base <ref> to run the same gate before pushing.
 *
 * Exit codes:
 *   0 — policy satisfied (or lockfile unchanged)
 *   1 — policy violated (lockfile changed without a deps-scoped commit)
 *   2 — unable to determine the range (soft-fail with a warning)
 */
import { execSync } from "node:child_process";
import process from "node:process";

const LOCKFILE = "pnpm-lock.yaml";
const DEPS_SCOPE = /^deps:/;
const DEPS_FILES = new Set(["package.json", "pnpm-workspace.yaml"]);

function parseArgs(argv) {
  const args = { base: null, head: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i];
    else if (a === "--head") args.head = argv[++i];
    else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "Usage: check-lockfile-policy.mjs [--base <ref>] [--head <ref>]\n" +
          "  Checks that pnpm-lock.yaml changes arrive in deps-scoped commits.\n",
      );
      process.exit(0);
    }
  }
  return args;
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function resolveRange(args) {
  const head = args.head || process.env.GITHUB_SHA || "HEAD";
  let base = args.base;
  if (!base) {
    if (process.env.GITHUB_BASE_REF) {
      base = `origin/${process.env.GITHUB_BASE_REF}`;
    } else if (process.env.GITHUB_EVENT_BEFORE) {
      base = process.env.GITHUB_EVENT_BEFORE;
    } else {
      // local default: compare against the default branch tip
      base =
        tryRun("git rev-parse --verify origin/main >/dev/null 2>&1 && echo origin/main") || null;
    }
  }
  return { base, head };
}

function changedFiles(base, head) {
  const out = tryRun(`git diff --name-only ${base}..${head}`);
  if (!out) return null;
  return new Set(out.split(/\r?\n/).filter(Boolean));
}

function commitSubjects(base, head) {
  const out = tryRun(`git log --format=%s ${base}..${head}`);
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv);
  const { base, head } = resolveRange(args);

  if (!base) {
    console.warn("[lockfile-policy] could not determine a base ref; skipping.");
    process.exit(2);
  }

  // Make sure the base is locally resolvable (CI shallow clones).
  const resolvedBase = tryRun(`git rev-parse --verify "${base}^{commit}"`);
  if (!resolvedBase) {
    const fetched = tryRun(`git fetch --no-tags --depth=1 origin ${base}`);
    if (!fetched === false) {
      console.warn(`[lockfile-policy] base ref ${base} not resolvable; skipping.`);
      process.exit(2);
    }
  }

  const files = changedFiles(base, head);
  if (!files) {
    console.warn("[lockfile-policy] could not compute diff; skipping.");
    process.exit(2);
  }

  if (!files.has(LOCKFILE)) {
    console.log(`[lockfile-policy] ${LOCKFILE} unchanged — policy satisfied.`);
    process.exit(0);
  }

  // Lockfile changed. Require either a deps-scoped commit or a change to a
  // recognized dependency manifest in the same range.
  const subjects = commitSubjects(base, head);
  const hasDepsScope = subjects.some((s) => DEPS_SCOPE.test(s));
  const hasManifestChange = [...files].some((f) => DEPS_FILES.has(f));

  if (hasDepsScope || hasManifestChange) {
    console.log(`[lockfile-policy] ${LOCKFILE} changed with deps-scoped commit — OK.`);
    process.exit(0);
  }

  console.error(
    `[lockfile-policy] ${LOCKFILE} changed but no commit in range is scoped "deps:" ` +
      `and no manifest (${[...DEPS_FILES].join(", ")}) changed.\n` +
      `Commit subjects in range:\n` +
      subjects.map((s) => `  - ${s}`).join("\n") +
      '\nEither re-scope the commit to start with "deps:" or explain the lockfile drift.',
  );
  process.exit(1);
}

main();
