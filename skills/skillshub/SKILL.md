---
name: skillshub
description: Use the Skills Hub CLI to search, install, update, and publish agent skills from hub.apilium.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed skillshub CLI.
metadata:
  {
    "mayros":
      {
        "requires": { "bins": ["skillshub"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "skillshub",
              "bins": ["skillshub"],
              "label": "Install Skills Hub CLI (npm)",
            },
          ],
      },
  }
---

# Skills Hub CLI

Install

```bash
npm i -g skillshub
```

Auth (publish)

```bash
skillshub login
skillshub whoami
```

Search

```bash
skillshub search "postgres backups"
```

Install

```bash
skillshub install my-skill
skillshub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)

```bash
skillshub update my-skill
skillshub update my-skill --version 1.2.3
skillshub update --all
skillshub update my-skill --force
skillshub update --all --no-input --force
```

List

```bash
skillshub list
```

Publish

```bash
skillshub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes

- Default registry: https://hub.apilium.com (override with SKILLSHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to Mayros workspace); install dir: ./skills (override with --workdir / --dir / SKILLSHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
