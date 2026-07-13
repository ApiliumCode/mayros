# Security Policy

If you believe you've found a security issue in Mayros, please report it privately.

## Reporting

Report vulnerabilities directly to the repository where the issue lives:

- **Core CLI and gateway** — [mayros/mayros](https://github.com/ApiliumCode/mayros)
- **macOS desktop app** — [mayros/mayros](https://github.com/ApiliumCode/mayros) (apps/macos)
- **iOS app** — [mayros/mayros](https://github.com/ApiliumCode/mayros) (apps/ios)
- **Android app** — [mayros/mayros](https://github.com/ApiliumCode/mayros) (apps/android)
- **Skills Hub** — [ApiliumCode/skills-hub](https://github.com/ApiliumCode/skills-hub)

For issues that don't fit a specific repo, or if you're unsure, email **security@apilium.com** and we'll route it.

For full reporting instructions see our [Trust page](https://apilium.com/us/trust).

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.

## Security & Trust

**Jamieson O'Reilly** ([@theonejvo](https://twitter.com/theonejvo)) is Security & Trust at Mayros. Jamieson is the founder of [Dvuln](https://dvuln.com) and brings extensive experience in offensive security, penetration testing, and security program development.

## Bug Bounties

Mayros is a labor of love. There is no bug bounty program and no budget for paid reports. Please still disclose responsibly so we can fix issues quickly.
The best way to help the project right now is by sending PRs.

## Maintainers: GHSA Updates via CLI

When patching a GHSA via `gh api`, include `X-GitHub-Api-Version: 2022-11-28` (or newer). Without it, some fields (notably CVSS) may not persist even if the request returns 200.

## Out of Scope

- Public Internet Exposure
- Using Mayros in ways that the docs recommend not to
- Deployments where mutually untrusted/adversarial operators share one gateway host and config
- Prompt injection attacks

## Deployment Assumptions

Mayros security guidance assumes:

- The host where Mayros runs is within a trusted OS/admin boundary.
- Anyone who can modify `~/.mayros` state/config (including `mayros.json`) is effectively a trusted operator.
- A single Gateway shared by mutually untrusted people is **not a recommended setup**. Use separate gateways (or at minimum separate OS users/hosts) per trust boundary.

## Plugin Trust Boundary

Plugins/extensions are loaded **in-process** with the Gateway and are treated as trusted code.

- Plugins can execute with the same OS privileges as the Mayros process.
- Runtime helpers (for example `runtime.system.runCommandWithTimeout`) are convenience APIs, not a sandbox boundary.
- Only install plugins you trust, and prefer `plugins.allow` to pin explicit trusted plugin ids.

## Operational Guidance

For threat model + hardening guidance (including `mayros security audit --deep` and `--fix`), see:

- `https://apilium.com/us/doc/maryos/gateway/security`

### Tool filesystem hardening

- `tools.exec.applyPatch.workspaceOnly: true` (recommended): keeps `apply_patch` writes/deletes within the configured workspace directory.
- `tools.fs.workspaceOnly: true` (optional): restricts `read`/`write`/`edit`/`apply_patch` paths to the workspace directory.
- Avoid setting `tools.exec.applyPatch.workspaceOnly: false` unless you fully trust who can trigger tool execution.

### Web Interface Safety

Mayros's web interface (Gateway Control UI + HTTP endpoints) is intended for **local use only**.

- Recommended: keep the Gateway **loopback-only** (`127.0.0.1` / `::1`).
  - Config: `gateway.bind="loopback"` (default).
  - CLI: `mayros gateway run --bind loopback`.
- Canvas host note: network-visible canvas is **intentional** for trusted node scenarios (LAN/tailnet).
  - Expected setup: non-loopback bind + Gateway auth (token/password/trusted-proxy) + firewall/tailnet controls.
  - Expected routes: `/__mayros__/canvas/`, `/__mayros__/a2ui/`.
  - This deployment model alone is not a security vulnerability.
- Do **not** expose it to the public internet (no direct bind to `0.0.0.0`, no public reverse proxy). It is not hardened for public exposure.
- If you need remote access, prefer an SSH tunnel or Tailscale serve/funnel (so the Gateway still binds to loopback), plus strong Gateway auth.
- The Gateway HTTP surface includes the canvas host (`/__mayros__/canvas/`, `/__mayros__/a2ui/`). Treat canvas content as sensitive/untrusted and avoid exposing it beyond loopback unless you understand the risk.

## Runtime Requirements

### Node.js Version

Mayros requires **Node.js 22.12.0 or later** (LTS). This version includes important security patches:

- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

Verify your Node.js version:

```bash
node --version  # Should be v22.12.0 or later
```

### Docker Security

When running Mayros in Docker:

1. The official image runs as a non-root user (`node`) for reduced attack surface
2. Use `--read-only` flag when possible for additional filesystem protection
3. Limit container capabilities with `--cap-drop=ALL`

Example secure Docker run:

```bash
docker run --read-only --cap-drop=ALL \
  -v mayros-data:/app/data \
  mayros/mayros:latest
```

## Dependency Supply Chain

Mayros treats its dependency tree as part of its trust boundary. A malicious or
broken transitive package reaches users the moment it enters the lockfile, so the
project enforces the following controls in `package.json`:

### Release age floor

`pnpm.minimumReleaseAge: 2880` (48 hours) gates every resolution. A package
published less than 48 hours ago is not eligible for install, which buffers
against compromised or yanked releases that get quarantined shortly after
publish.

### Forced security overrides

The `pnpm.overrides` map forces specific versions of transitive dependencies
known to carry security regressions. Each override exists because a transitive
in the tree resolved to a vulnerable version and the override is the most
durable way to pin the patched floor without waiting for upstreams to bump.

When adding or changing an override, record why in the commit message: the CVE
or GHSA it addresses (or the regression it prevents). Overrides without a
recorded rationale are rejected in review.

### Patched dependencies

Any dependency declared in `pnpm.patchedDependencies` must use an exact version
(no `^` or `~`). This is a hard rule: a range on a patched package lets a future
resolve drift past the patch, silently reverting the fix.

### Lockfile discipline

The npm/pnpm lockfile pins the full transitive tree by content hash. Treat the
lockfile as a reviewed artifact, not an auto-generated one:

- A change to `pnpm-lock.yaml` without a corresponding dependency change in
  `package.json` is suspicious and must be explained in the commit.
- Dependabot/Renovate PRs that bump a transitive without a recorded CVE/fix are
  held until the change is understood.
- `pnpm install --frozen-lockfile` is the canonical install command in CI;
  `pnpm install` (which can mutate the lockfile) is reserved for local
  dependency changes that are committed alongside a `deps:` commit.

### Native build scripts

`pnpm.onlyBuiltDependencies` enumerates the packages allowed to run native
build scripts (node-gyp, prebuilt binaries). Packages not in this list cannot
execute install scripts, which limits the blast radius of a compromised native
dependency.

## Security Scanning

This project uses `detect-secrets` for automated secret detection in CI/CD.
See `.detect-secrets.cfg` for configuration and `.secrets.baseline` for the baseline.

Run locally:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline
```
