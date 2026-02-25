/**
 * Apilium Hub Plugin
 *
 * Marketplace for publishing, installing, signing, and verifying
 * semantic skills with Ed25519 signatures and PoL verification.
 */

import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { skillHubConfigSchema, tierFromScore, meetsTier } from "./config.js";
import { DependencyResolver, type ResolvedSkill } from "./dependency-resolver.js";
import { HubClient } from "./hub-client.js";
import { Keystore } from "./keystore.js";
import { readLockfile, writeLockfile, mergeLockfile, createLockEntry } from "./lockfile.js";
import { ReputationClient } from "./reputation.js";
import {
  createSkillSignature,
  signMessage,
  verifySkillSignature,
  type SignatureData,
} from "./signing.js";
import {
  buildFileHashes,
  buildPackageArchive,
  extractPackageArchive,
  extractPackageArchiveToTemp,
  promoteDir,
  cleanupTempDir,
} from "./skill-packager.js";
import {
  runVerificationPipeline,
  runVerificationOnTemp,
  type CortexLike,
} from "./verification-pipeline.js";

// ============================================================================
// Hub Auth Persistence
// ============================================================================

const HUB_AUTH_DIR = join(homedir(), ".mayros");
const HUB_AUTH_FILE = join(HUB_AUTH_DIR, "hub-auth.json");

async function saveHubAuth(token: string): Promise<void> {
  await mkdir(HUB_AUTH_DIR, { recursive: true });
  await writeFile(HUB_AUTH_FILE, JSON.stringify({ token }), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

async function loadHubAuth(): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(HUB_AUTH_FILE, "utf-8")) as { token?: string };
    return data.token;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

const skillHubPlugin = {
  id: "skill-hub",
  name: "Apilium Hub",
  description: "Marketplace for publishing, installing, signing, and verifying semantic skills",
  kind: "marketplace" as const,
  configSchema: skillHubConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = skillHubConfigSchema.parse(api.pluginConfig);
    const hubClient = new HubClient(cfg.hubUrl);
    const keystore = new Keystore(cfg.keysDir);
    const cortex = new CortexClient(cfg.cortex);
    const reputation = new ReputationClient(cortex);
    let cortexAvailable = false;

    api.logger.info(`skill-hub: registered (hub: ${cfg.hubUrl})`);

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await cortex.isHealthy();
      return cortexAvailable;
    }

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "hub_search",
        label: "Hub Search",
        description: "Search the Apilium Hub for semantic skills.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          category: Type.Optional(Type.String({ description: "Filter by category" })),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            category,
            limit = 10,
          } = params as {
            query: string;
            category?: string;
            limit?: number;
          };

          try {
            const result = await hubClient.search(query, { category, limit });

            if (result.skills.length === 0) {
              return {
                content: [{ type: "text", text: "No skills found." }],
                details: { total: 0 },
              };
            }

            const text = result.skills
              .map(
                (s) =>
                  `${s.slug} v${s.version} — ${s.description} (by ${s.author}, ${s.downloads} downloads)`,
              )
              .join("\n");

            return {
              content: [{ type: "text", text: `Found ${result.total} skills:\n\n${text}` }],
              details: result,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Hub search failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "hub_search" },
    );

    // Shared install helper for a single skill (used by tool + CLI)
    async function installSingleSkill(
      slug: string,
      version: string | undefined,
      skillsDir: string,
    ): Promise<{
      success: boolean;
      version: string;
      files: string[];
      hash: string;
      error?: string;
    }> {
      const archive = await hubClient.download(slug, version);
      const archiveHash = "sha256-" + createHash("sha256").update(archive).digest("hex");
      const info = await hubClient.getSkill(slug, version);
      const targetDir = join(skillsDir, slug);

      const { tempDir, files } = await extractPackageArchiveToTemp(archive, skillsDir, slug);

      const cortexForVerify = (await ensureCortex()) ? cortex : undefined;
      const verifyResult = await runVerificationOnTemp(
        tempDir,
        cfg.verification,
        cortexForVerify,
        cfg.agentNamespace,
      );

      if (cfg.verification.minTrustTier !== "untrusted" && cortexForVerify && info.author) {
        try {
          const consistency = await cortex.getConsistency(info.author);
          const authorTier = tierFromScore(consistency.total > 0 ? consistency.score : 0);
          if (!meetsTier(authorTier, cfg.verification.minTrustTier)) {
            await cleanupTempDir(tempDir);
            return {
              success: false,
              version: info.version,
              files,
              hash: archiveHash,
              error: `author "${info.author}" trust tier "${authorTier}" below required "${cfg.verification.minTrustTier}"`,
            };
          }
        } catch (err) {
          api.logger.warn(`skill-hub: reputation check failed: ${String(err)}`);
        }
      }

      if (!verifyResult.passed) {
        const failures = verifyResult.steps
          .filter((s) => !s.passed)
          .map((s) => `${s.step}: ${s.message}`)
          .join("; ");
        await cleanupTempDir(tempDir);
        return {
          success: false,
          version: info.version,
          files,
          hash: archiveHash,
          error: `verification failed — ${failures}`,
        };
      }

      await promoteDir(tempDir, targetDir);
      return { success: true, version: info.version, files, hash: archiveHash };
    }

    const depResolver = new DependencyResolver();

    api.registerTool(
      {
        name: "hub_install",
        label: "Hub Install",
        description: "Download and install a skill from the Apilium Hub (resolves dependencies).",
        parameters: Type.Object({
          slug: Type.String({ description: "Skill slug to install" }),
          version: Type.Optional(
            Type.String({ description: "Specific version (default: latest)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { slug, version } = params as { slug: string; version?: string };

          try {
            const skillsDir = api.resolvePath("skills");

            // Resolve dependencies
            const info = await hubClient.getSkill(slug, version);
            // TODO: when Hub API supports dependency metadata, resolve transitive deps
            const rootDeps = [{ slug, version: version ?? `^${info.version}` }];
            const resolved = await depResolver.resolve(rootDeps, hubClient);

            // Install in topological order
            const installed: string[] = [];
            const lockEntries: Record<
              string,
              { version: string; hash: string; resolvedAt: string }
            > = {};

            for (const skill of resolved.order) {
              const result = await installSingleSkill(skill.slug, skill.version, skillsDir);
              if (!result.success) {
                return {
                  content: [
                    { type: "text", text: `Install blocked for ${skill.slug}: ${result.error}` },
                  ],
                  details: { error: result.error, installed },
                };
              }
              installed.push(`${skill.slug}@${result.version}`);
              lockEntries[skill.slug] = createLockEntry(result.version, result.hash);
            }

            // Update lockfile
            const existingLock = await readLockfile(skillsDir);
            const newLock = mergeLockfile(existingLock, lockEntries);
            await writeLockfile(skillsDir, newLock);

            return {
              content: [
                {
                  type: "text",
                  text: `Installed ${installed.length} skill(s): ${installed.join(", ")}`,
                },
              ],
              details: { installed, total: resolved.total },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Install failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "hub_install" },
    );

    api.registerTool(
      {
        name: "hub_publish",
        label: "Hub Publish",
        description: "Package, sign, and publish a skill to the Apilium Hub.",
        parameters: Type.Object({
          skillDir: Type.String({ description: "Path to skill directory" }),
          slug: Type.String({ description: "Skill slug for the Hub" }),
          changelog: Type.Optional(Type.String({ description: "Changelog entry" })),
        }),
        async execute(_toolCallId, params) {
          const { skillDir, slug, changelog } = params as {
            skillDir: string;
            slug: string;
            changelog?: string;
          };

          try {
            // Build manifest and sign
            const fileHashes = await buildFileHashes(skillDir);
            const keyPair = await keystore.loadKeyPair();

            const sig = createSkillSignature(fileHashes, keyPair.publicKey, keyPair.privateKey);

            // Write SKILL.sig
            await writeFile(join(skillDir, "SKILL.sig"), JSON.stringify(sig, null, 2), "utf-8");

            // Read SKILL.md for metadata and skillVersion
            const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
            const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
            const descMatch = skillMd.match(/^description:\s*(.+)$/m);
            const versionMatch = skillMd.match(/skillVersion:\s*["']?(\d+\.\d+\.\d+[^\s"']*)["']?/);

            // Use semver from manifest or fallback to date-based version
            let publishVersion: string;
            if (versionMatch?.[1]) {
              const { valid } = await import("semver");
              if (!valid(versionMatch[1])) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Invalid semver in SKILL.md: "${versionMatch[1]}". Use format like "1.0.0".`,
                    },
                  ],
                  details: { error: "invalid-semver" },
                };
              }
              publishVersion = versionMatch[1];
            } else {
              publishVersion = new Date().toISOString().split("T")[0];
            }

            // Extract dependencies from SKILL.md frontmatter
            const depsMatch = skillMd.match(/dependencies:\s*\n((?:\s+-[^\n]+\n?)*)/);
            const dependencies: { slug: string; version: string }[] = [];
            if (depsMatch?.[1]) {
              for (const line of depsMatch[1].split("\n")) {
                const depMatch = line.match(/^\s+-\s+(\S+):\s*["']?(\S+?)["']?\s*$/);
                if (depMatch) {
                  dependencies.push({ slug: depMatch[1], version: depMatch[2] });
                }
              }
            }

            const archive = await buildPackageArchive(skillDir);

            // Publish to Hub
            const result = await hubClient.publish(slug, Buffer.from(JSON.stringify(archive)), {
              name: nameMatch?.[1]?.trim() ?? slug,
              description: descMatch?.[1]?.trim() ?? "",
              version: publishVersion,
              changelog,
              signature: JSON.stringify(sig),
              ...(dependencies.length > 0 ? { dependencies } : {}),
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Published ${slug} v${result.version} to ${result.url}`,
                },
              ],
              details: result,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Publish failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "hub_publish" },
    );

    api.registerTool(
      {
        name: "hub_verify",
        label: "Hub Verify",
        description: "Run the full verification pipeline on a local skill.",
        parameters: Type.Object({
          skillDir: Type.String({ description: "Path to skill directory" }),
        }),
        async execute(_toolCallId, params) {
          const { skillDir } = params as { skillDir: string };

          const cortexForVerify = (await ensureCortex()) ? cortex : undefined;

          const result = await runVerificationPipeline(
            skillDir,
            cfg.verification,
            cortexForVerify,
            cfg.agentNamespace,
          );

          const stepsSummary = result.steps
            .map((s) => `${s.passed ? "PASS" : "FAIL"} ${s.step}: ${s.message}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Verification: ${result.passed ? "PASSED" : "FAILED"}\n\n${stepsSummary}`,
              },
            ],
            details: result,
          };
        },
      },
      { name: "hub_verify" },
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    // Hook: before_agent_start — warn or block unsigned skills
    api.on("before_agent_start", async (event) => {
      if (!cfg.verification.requireSignature && !cfg.verification.blockUnsigned) return;

      const skills = (event as Record<string, unknown>).skills;
      if (!Array.isArray(skills)) return;

      const unsigned: string[] = [];
      for (const skill of skills) {
        if (!skill || typeof skill !== "object") continue;
        const skillObj = skill as Record<string, unknown>;
        const name = skillObj.name as string;
        const dir = skillObj.dir as string;
        if (!dir) continue;

        try {
          await readFile(join(dir, "SKILL.sig"), "utf-8");
        } catch {
          unsigned.push(name);
        }
      }

      if (unsigned.length === 0) return;

      if (cfg.verification.blockUnsigned) {
        api.logger.warn(
          `skill-hub: BLOCKED ${unsigned.length} unsigned skill(s): ${unsigned.join(", ")}`,
        );
        return {
          prependContext: `[SECURITY] The following skills are unsigned and blocked by policy (blockUnsigned=true). Do NOT use them: ${unsigned.join(", ")}`,
        };
      }

      api.logger.warn(`skill-hub: ${unsigned.length} unsigned skill(s): ${unsigned.join(", ")}`);
    });

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const hub = program.command("hub").description("Apilium Hub marketplace commands");

        hub
          .command("search")
          .description("Search the Hub for skills")
          .argument("<query>", "Search query")
          .option("--category <cat>", "Filter by category")
          .option("--limit <n>", "Max results", "10")
          .action(async (query, opts) => {
            try {
              const result = await hubClient.search(query, {
                category: opts.category,
                limit: parseInt(opts.limit),
              });
              if (result.skills.length === 0) {
                console.log("No skills found.");
                return;
              }
              for (const s of result.skills) {
                console.log(`${s.slug} v${s.version} — ${s.description}`);
                console.log(
                  `  author: ${s.author} | downloads: ${s.downloads} | rating: ${s.rating}`,
                );
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        hub
          .command("install")
          .description("Install a skill from the Hub (resolves dependencies)")
          .argument("<slug>", "Skill slug")
          .option("--version <ver>", "Specific version")
          .action(async (slug, opts) => {
            try {
              const info = await hubClient.getSkill(slug, opts.version);
              console.log(`Resolving dependencies for ${slug} v${info.version}...`);

              const skillsDir = api.resolvePath("skills");

              // Resolve dependency graph
              const rootDeps = [{ slug, version: opts.version ?? `^${info.version}` }];
              const resolved = await depResolver.resolve(rootDeps, hubClient);

              console.log(`Installing ${resolved.total} skill(s) in order...`);

              const lockEntries: Record<
                string,
                { version: string; hash: string; resolvedAt: string }
              > = {};

              for (const skill of resolved.order) {
                console.log(`  Installing ${skill.slug}@${skill.version}...`);
                const result = await installSingleSkill(skill.slug, skill.version, skillsDir);
                if (!result.success) {
                  console.error(`  Installation aborted for ${skill.slug}: ${result.error}`);
                  return;
                }
                lockEntries[skill.slug] = createLockEntry(result.version, result.hash);
                console.log(
                  `  Installed ${skill.slug} v${result.version} (${result.files.length} files)`,
                );
              }

              // Update lockfile
              const existingLock = await readLockfile(skillsDir);
              const newLock = mergeLockfile(existingLock, lockEntries);
              await writeLockfile(skillsDir, newLock);

              console.log(`\nDone. ${resolved.total} skill(s) installed. Lockfile updated.`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        hub
          .command("update")
          .description("Update installed Hub skills")
          .argument("[slug]", "Specific skill slug (or --all)")
          .option("--all", "Update all installed skills")
          .action(async (slug, opts) => {
            if (!slug && !opts.all) {
              console.log("Specify a skill slug or --all to update all installed skills.");
              return;
            }

            try {
              const skillsDir = api.resolvePath("skills");
              let slugsToUpdate: string[] = [];

              if (slug) {
                slugsToUpdate = [slug];
              } else {
                // Scan skills/ for dirs with SKILL.sig (Hub-installed skills)
                const entries = await readdir(skillsDir, { withFileTypes: true });
                for (const entry of entries) {
                  if (!entry.isDirectory()) continue;
                  try {
                    await access(join(skillsDir, entry.name, "SKILL.sig"));
                    slugsToUpdate.push(entry.name);
                  } catch {
                    // No SKILL.sig — not a Hub-installed skill, skip
                  }
                }
              }

              if (slugsToUpdate.length === 0) {
                console.log("No Hub-installed skills found.");
                return;
              }

              let updated = 0;
              for (const s of slugsToUpdate) {
                try {
                  const latest = await hubClient.getSkill(s);
                  const targetDir = join(skillsDir, s);

                  // Compare with local SKILL.sig timestamp
                  let localVersion = "";
                  try {
                    const sigData = JSON.parse(
                      await readFile(join(targetDir, "SKILL.sig"), "utf-8"),
                    );
                    localVersion = sigData.timestamp ?? "";
                  } catch {
                    // No local sig — treat as outdated
                  }

                  if (latest.publishedAt && latest.publishedAt > localVersion) {
                    console.log(`Updating ${s} to v${latest.version}...`);
                    const archive = await hubClient.download(s);

                    // Verify-then-promote flow
                    const { tempDir, files } = await extractPackageArchiveToTemp(
                      archive,
                      skillsDir,
                      s,
                    );

                    const cortexForVerify = (await ensureCortex()) ? cortex : undefined;
                    const result = await runVerificationOnTemp(
                      tempDir,
                      cfg.verification,
                      cortexForVerify,
                      cfg.agentNamespace,
                    );

                    for (const step of result.steps) {
                      console.log(
                        `  ${step.passed ? "PASS" : "FAIL"} ${step.step}: ${step.message}`,
                      );
                    }

                    if (!result.passed) {
                      await cleanupTempDir(tempDir);
                      console.error(`  Update aborted for ${s}: verification failed.`);
                    } else {
                      await promoteDir(tempDir, targetDir);
                      console.log(`  Updated ${s} (${files.length} files, verification passed)`);
                      updated++;
                    }
                  } else {
                    console.log(`${s} is already up to date.`);
                  }
                } catch (err) {
                  console.error(`  Failed to update ${s}: ${String(err)}`);
                }
              }

              console.log(`\nDone. ${updated}/${slugsToUpdate.length} skill(s) updated.`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        hub
          .command("publish")
          .description("Package, sign, and publish a skill")
          .argument("<dir>", "Skill directory")
          .option("--changelog <text>", "Changelog entry")
          .action(async (dir, opts) => {
            try {
              const fileHashes = await buildFileHashes(dir);
              const keyPair = await keystore.loadKeyPair();
              const sig = createSkillSignature(fileHashes, keyPair.publicKey, keyPair.privateKey);
              await writeFile(join(dir, "SKILL.sig"), JSON.stringify(sig, null, 2), "utf-8");
              console.log("SKILL.sig created.");

              // Derive slug from directory name
              const { basename } = await import("node:path");
              const slug = basename(dir);

              const skillMd = await readFile(join(dir, "SKILL.md"), "utf-8");
              const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
              const descMatch = skillMd.match(/^description:\s*(.+)$/m);
              const versionMatch = skillMd.match(
                /skillVersion:\s*["']?(\d+\.\d+\.\d+[^\s"']*)["']?/,
              );

              // Use semver from manifest or fallback to date
              let publishVersion: string;
              if (versionMatch?.[1]) {
                const { valid } = await import("semver");
                if (!valid(versionMatch[1])) {
                  console.error(
                    `Invalid semver in SKILL.md: "${versionMatch[1]}". Use format like "1.0.0".`,
                  );
                  return;
                }
                publishVersion = versionMatch[1];
              } else {
                publishVersion = new Date().toISOString().split("T")[0];
                console.log(`No skillVersion in SKILL.md, using date: ${publishVersion}`);
              }

              // Extract dependencies from SKILL.md frontmatter
              const depsMatch = skillMd.match(/dependencies:\s*\n((?:\s+-[^\n]+\n?)*)/);
              const dependencies: { slug: string; version: string }[] = [];
              if (depsMatch?.[1]) {
                for (const line of depsMatch[1].split("\n")) {
                  const depMatch = line.match(/^\s+-\s+(\S+):\s*["']?(\S+?)["']?\s*$/);
                  if (depMatch) {
                    dependencies.push({ slug: depMatch[1], version: depMatch[2] });
                  }
                }
              }

              console.log(`Publishing ${slug} v${publishVersion}...`);

              const archive = await buildPackageArchive(dir);

              const result = await hubClient.publish(slug, Buffer.from(JSON.stringify(archive)), {
                name: nameMatch?.[1]?.trim() ?? slug,
                description: descMatch?.[1]?.trim() ?? "",
                version: publishVersion,
                changelog: opts.changelog,
                signature: JSON.stringify(sig),
                ...(dependencies.length > 0 ? { dependencies } : {}),
              });

              console.log(`Published: ${result.url}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        hub
          .command("verify")
          .description("Run verification pipeline locally")
          .argument("<dir>", "Skill directory")
          .action(async (dir) => {
            const cortexForVerify = (await ensureCortex()) ? cortex : undefined;
            const result = await runVerificationPipeline(
              dir,
              cfg.verification,
              cortexForVerify,
              cfg.agentNamespace,
            );

            for (const step of result.steps) {
              const icon = step.passed ? "PASS" : "FAIL";
              console.log(`${icon} ${step.step}: ${step.message}`);
            }

            console.log(`\nOverall: ${result.passed ? "PASSED" : "FAILED"}`);
          });

        hub
          .command("deps")
          .description("Show dependency tree for a Hub skill")
          .argument("<slug>", "Skill slug")
          .option("--version <ver>", "Specific version")
          .action(async (slug, opts) => {
            try {
              const info = await hubClient.getSkill(slug, opts.version);
              console.log(`${slug} v${info.version}`);

              const rootDeps = [{ slug, version: opts.version ?? `^${info.version}` }];
              const resolved = await depResolver.resolve(rootDeps, hubClient);

              if (resolved.total <= 1) {
                console.log("  (no dependencies)");
              } else {
                for (const skill of resolved.order) {
                  if (skill.slug === slug) continue;
                  const depInfo =
                    skill.dependencies.length > 0
                      ? ` (requires: ${skill.dependencies.join(", ")})`
                      : "";
                  console.log(`  ${skill.slug}@${skill.version}${depInfo}`);
                }
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        // --- Key management ---

        const keys = hub.command("keys").description("Ed25519 key management");

        keys
          .command("init")
          .description("Generate a new Ed25519 keypair")
          .action(async () => {
            try {
              const keyPair = await keystore.init();
              console.log("Ed25519 keypair generated.");
              console.log(`Public key: ${keyPair.publicKey.slice(0, 44)}...`);
              console.log(`Keys stored in: ${cfg.keysDir}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        keys
          .command("show")
          .description("Show public key")
          .action(async () => {
            try {
              const pub = await keystore.loadPublicKey();
              console.log(`Public key: ${pub}`);
            } catch (err) {
              console.error(`No keypair found. Run 'mayros hub keys init' first.`);
            }
          });

        keys
          .command("export")
          .description("Export public key for Hub registration")
          .action(async () => {
            try {
              const pub = await keystore.exportPublicKey();
              console.log(pub);
            } catch (err) {
              console.error(`No keypair found. Run 'mayros hub keys init' first.`);
            }
          });

        // --- Auth ---

        hub
          .command("login")
          .description("Authenticate with the Hub (challenge-response)")
          .action(async () => {
            try {
              const keyPair = await keystore.loadKeyPair();
              console.log("Requesting challenge...");

              const challenge = await hubClient.requestLoginChallenge(keyPair.publicKey);
              console.log(`Challenge received (expires: ${challenge.expiresAt})`);

              // Sign the challenge
              const signature = signMessage(
                Buffer.from(challenge.challenge, "utf-8"),
                keyPair.privateKey,
              );

              const { token } = await hubClient.submitLoginResponse(
                keyPair.publicKey,
                challenge.challenge,
                signature,
              );

              hubClient.setAuthToken(token);
              await saveHubAuth(token);
              console.log("Authenticated successfully.");
            } catch (err) {
              console.error(`Login failed: ${String(err)}`);
            }
          });

        hub
          .command("whoami")
          .description("Show logged-in identity")
          .action(async () => {
            try {
              const identity = await hubClient.whoami();
              console.log(`Name: ${identity.name}`);
              console.log(`ID: ${identity.id}`);
              console.log(`Registered: ${identity.registeredAt}`);
            } catch (err) {
              console.error(`Not logged in or error: ${String(err)}`);
            }
          });

        // --- Forge CLI ---

        const forge = program.command("forge").description("Semantic skill development tools");

        forge
          .command("init")
          .description("Scaffold a new semantic skill")
          .argument("<name>", "Skill name")
          .action(async (name) => {
            const skillDir = join(api.resolvePath("skills"), name);
            await mkdir(skillDir, { recursive: true });

            const skillMd = `---
name: ${name}
description: A semantic skill
type: semantic
semantic:
  version: 1
  permissions:
    graph: [read]
    proofs: []
    memory: [recall]
  assertions: []
  queries:
    - predicate: "${name}:status"
      scope: agent
---

# ${name}

Describe your semantic skill here.

## Instructions

Tell the agent what this skill does and when to use it.
`;

            await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf-8");

            const skillTs = `/**
 * ${name} — semantic skill runtime handler
 *
 * Implements the SkillRuntime contract for lifecycle management.
 */
import type { SkillRuntime } from "../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "${name}",
  async onActivate(ctx) {
    ctx.logger.info(\`${name} activated for \${ctx.agentId} in \${ctx.namespace}\`);
  },
  async onDeactivate(ctx) {
    // Called when the skill is deactivated (session end, reload, or unload)
  },
  async onQuery(ctx) {
    // Called after graph queries — enrich or filter results
    return { results: ctx.results };
  },
};

export default runtime;
`;
            await writeFile(join(skillDir, "skill.ts"), skillTs, "utf-8");

            console.log(`Scaffolded semantic skill: ${skillDir}`);
            console.log("  SKILL.md — manifest + instructions");
            console.log("  skill.ts — runtime handler");
          });

        forge
          .command("autocomplete")
          .description("Get ontology-aware completions from Cortex")
          .argument("<ctx>", "Context string (e.g., partial predicate)")
          .action(async (ctx) => {
            if (!(await ensureCortex())) {
              console.error("Cortex unavailable.");
              return;
            }

            try {
              // Query known predicates
              const result = await cortex.listPredicates({
                namespace: cfg.agentNamespace,
                limit: 50,
              });

              const lower = ctx.toLowerCase();
              const matches = result.predicates.filter((p) => p.toLowerCase().includes(lower));

              console.log(JSON.stringify({ completions: matches }, null, 2));
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        forge
          .command("test")
          .description("Test a skill against Cortex sandbox")
          .argument("<dir>", "Skill directory")
          .action(async (dir) => {
            if (!(await ensureCortex())) {
              console.error("Cortex unavailable.");
              return;
            }

            try {
              const sandbox = await cortex.createSandbox(
                `forge:test:${Date.now()}`,
                cfg.verification.sandboxTtlSeconds,
              );
              console.log(`Sandbox: ${sandbox.id} (ns: ${sandbox.namespace})`);

              // Run verification pipeline
              const result = await runVerificationPipeline(
                dir,
                { ...cfg.verification, sandboxTest: true },
                cortex,
                sandbox.namespace,
              );

              for (const step of result.steps) {
                console.log(`  ${step.passed ? "PASS" : "FAIL"} ${step.step}: ${step.message}`);
              }

              await cortex.deleteSandbox(sandbox.id);
              console.log("Sandbox cleaned up.");
              console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        forge
          .command("publish")
          .description("Alias for 'mayros hub publish'")
          .argument("<dir>", "Skill directory")
          .action(async (dir) => {
            console.log(`Publishing ${dir} via Hub...`);
            try {
              const fileHashes = await buildFileHashes(dir);
              const keyPair = await keystore.loadKeyPair();
              const sig = createSkillSignature(fileHashes, keyPair.publicKey, keyPair.privateKey);
              await writeFile(join(dir, "SKILL.sig"), JSON.stringify(sig, null, 2), "utf-8");

              const { basename } = await import("node:path");
              const slug = basename(dir);

              const skillMd = await readFile(join(dir, "SKILL.md"), "utf-8");
              const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
              const versionMatch = skillMd.match(
                /skillVersion:\s*["']?(\d+\.\d+\.\d+[^\s"']*)["']?/,
              );
              const publishVersion = versionMatch?.[1] ?? new Date().toISOString().split("T")[0];

              // Extract dependencies from SKILL.md frontmatter
              const depsMatch = skillMd.match(/dependencies:\s*\n((?:\s+-[^\n]+\n?)*)/);
              const dependencies: { slug: string; version: string }[] = [];
              if (depsMatch?.[1]) {
                for (const line of depsMatch[1].split("\n")) {
                  const depMatch = line.match(/^\s+-\s+(\S+):\s*["']?(\S+?)["']?\s*$/);
                  if (depMatch) {
                    dependencies.push({ slug: depMatch[1], version: depMatch[2] });
                  }
                }
              }

              const archive = await buildPackageArchive(dir);

              const result = await hubClient.publish(slug, Buffer.from(JSON.stringify(archive)), {
                name: nameMatch?.[1]?.trim() ?? slug,
                description: "",
                version: publishVersion,
                signature: JSON.stringify(sig),
                ...(dependencies.length > 0 ? { dependencies } : {}),
              });
              console.log(`Published: ${result.url}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });
      },
      { commands: ["hub", "forge"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "skill-hub",
      async start() {
        cortexAvailable = await cortex.isHealthy();
        const hasKeys = await keystore.hasKeys();

        // Restore persisted auth token
        const savedToken = await loadHubAuth();
        if (savedToken) {
          hubClient.setAuthToken(savedToken);
        }

        api.logger.info(
          `skill-hub: initialized (hub: ${cfg.hubUrl}, cortex: ${cortexAvailable ? "connected" : "offline"}, keys: ${hasKeys ? "found" : "none"}, auth: ${savedToken ? "restored" : "none"})`,
        );
      },
      async stop() {
        api.logger.info("skill-hub: stopped");
      },
    });
  },
};

export default skillHubPlugin;
