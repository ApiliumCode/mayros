# Mayros Transfer — Setup on Windows

## 1. Extract this zip anywhere

## 2. Restore the repo
```powershell
cd C:\Users\<you>\repositorios\apilium
git clone repo/maryosCode.git maryosCode
cd maryosCode
git checkout feature/v0.3.0-remote-terminal
pnpm install
pnpm build
```

## 3. SSH key for git signing
```powershell
mkdir -Force $env:USERPROFILE\.ssh
copy ssh-keys\ApiliumDevTeam-GitHub $env:USERPROFILE\.ssh\
copy ssh-keys\ApiliumDevTeam-GitHub.pub $env:USERPROFILE\.ssh\

# Git config
git config --global user.name "It Apilium"
git config --global user.email "it@apilium.com"
git config --global gpg.format ssh
git config --global user.signingkey "$env:USERPROFILE\.ssh\ApiliumDevTeam-GitHub"
git config --global commit.gpgsign true
```

## 4. Mayros config
```powershell
mkdir -Force $env:USERPROFILE\.mayros
copy mayros-config\mayros.json $env:USERPROFILE\.mayros\
xcopy /E cortex-data $env:USERPROFILE\.mayros\cortex-data\
```

## 5. Claude Code memory
```powershell
# Find your project path in Claude Code (it uses the full path as key)
# On Windows it will be something like:
# C:\Users\<you>\.claude\projects\-C-Users-<you>-repositorios-apilium-maryosCode\
mkdir -Force "$env:USERPROFILE\.claude\projects\-C-Users-<you>-repositorios-apilium-maryosCode\memory"
xcopy /E claude-memory\* "$env:USERPROFILE\.claude\projects\-C-Users-<you>-repositorios-apilium-maryosCode\memory\"
```

## 6. Secret plans (already in the repo under .secret/)
The .secret/ directory is gitignored and contains:
- v0.3.0-kaneru-dethrone-plan.md — Full Kaneru plan
- KANERU-MASTER-PROMPT.md — Master prompt for invoking milestones
- M1-paperclip-intel.md — Competitive intelligence
- M1-architecture-plan.md — Architecture decisions

Copy these into the repo's .secret/ if not present:
```powershell
xcopy /E secret-plans\* maryosCode\.secret\
```

## 7. Start Claude Code
```powershell
cd maryosCode
claude
```

Then paste:
```
I'm continuing the Kaneru v0.3.0 release on feature/v0.3.0-remote-terminal.
M1 (Surface Kaneru) is committed. Build clean, 12241 tests pass.
Read .secret/KANERU-MASTER-PROMPT.md for the process.
Read .secret/v0.3.0-kaneru-dethrone-plan.md for the full plan.
Resume M1 Phase 4 (QA), then proceed to M2.
```

## Repos needed (clone from GitHub)
- Mayros: git@github.com:ApiliumCode/mayros.git
- AIngle (reference): git@github.com:ApiliumCode/aingle.git  
- Paperclip (competitive study): git@github.com:paperclipai/paperclip.git
