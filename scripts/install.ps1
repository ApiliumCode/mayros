# Mayros Installer for Windows (PowerShell)
# Usage: irm https://mayros.apilium.com/install.ps1 | iex
#
# Installs Mayros CLI and ensures Node >= 22 is available.
# Uses fnm (Fast Node Manager) if Node is missing or too old.

$ErrorActionPreference = "Stop"

$RequiredNodeMajor = 22

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

function Write-Info  { param($Msg) Write-Host "info  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param($Msg) Write-Host "ok    $Msg" -ForegroundColor Green }
function Write-Warn  { param($Msg) Write-Host "warn  $Msg" -ForegroundColor Yellow }
function Write-Err   { param($Msg) Write-Host "error $Msg" -ForegroundColor Red }

function Exit-Fatal {
    param($Msg)
    Write-Err $Msg
    exit 1
}

# ---------------------------------------------------------------------------
# OS / arch detection
# ---------------------------------------------------------------------------

function Get-Platform {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64"   { return "x64" }
        "Arm64" { return "arm64" }
        default { Exit-Fatal "Unsupported architecture: $arch" }
    }
}

# ---------------------------------------------------------------------------
# Node version check
# ---------------------------------------------------------------------------

function Test-Node {
    if ($env:MAYROS_SKIP_NODE -eq "1") {
        Write-Info "Skipping Node check (MAYROS_SKIP_NODE=1)"
        return $true
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        return $false
    }

    $version = & node --version 2>$null
    if (-not $version) { return $false }

    $major = [int]($version -replace '^v','').Split('.')[0]
    if ($major -ge $RequiredNodeMajor) {
        Write-Ok "Node $version detected (>= $RequiredNodeMajor required)"
        return $true
    }

    Write-Warn "Node $version is too old (>= $RequiredNodeMajor required)"
    return $false
}

# ---------------------------------------------------------------------------
# Install Node via fnm
# ---------------------------------------------------------------------------

function Install-NodeViaFnm {
    Write-Info "Installing fnm (Fast Node Manager)..."

    $fnmCmd = Get-Command fnm -ErrorAction SilentlyContinue
    if (-not $fnmCmd) {
        # Install fnm via winget if available, otherwise via cargo or manual download
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            & winget install Schniz.fnm --accept-package-agreements --accept-source-agreements
        } else {
            # Fallback: download fnm binary
            $arch = Get-Platform
            $fnmZip = "$env:TEMP\fnm.zip"
            $fnmDir = "$env:LOCALAPPDATA\fnm"

            if (-not (Test-Path $fnmDir)) {
                New-Item -ItemType Directory -Path $fnmDir -Force | Out-Null
            }

            $downloadUrl = "https://github.com/Schniz/fnm/releases/latest/download/fnm-win.zip"
            Write-Info "Downloading fnm from $downloadUrl"
            Invoke-WebRequest -Uri $downloadUrl -OutFile $fnmZip -UseBasicParsing
            Expand-Archive -Path $fnmZip -DestinationPath $fnmDir -Force
            Remove-Item $fnmZip -Force

            # Add to PATH for this session
            $env:PATH = "$fnmDir;$env:PATH"
        }

        # Verify fnm is now available
        $fnmCmd = Get-Command fnm -ErrorAction SilentlyContinue
        if (-not $fnmCmd) {
            # Try refreshing PATH
            $env:PATH = "$env:LOCALAPPDATA\fnm;$env:PATH"
            $fnmCmd = Get-Command fnm -ErrorAction SilentlyContinue
            if (-not $fnmCmd) {
                Exit-Fatal "fnm installation failed. Install Node >= $RequiredNodeMajor manually."
            }
        }
    } else {
        Write-Info "fnm already installed"
    }

    Write-Info "Installing Node $RequiredNodeMajor via fnm..."
    & fnm install $RequiredNodeMajor
    & fnm use $RequiredNodeMajor
    & fnm env --use-on-cd | Out-String | Invoke-Expression

    $version = & node --version 2>$null
    Write-Ok "Node $version installed via fnm"
}

# ---------------------------------------------------------------------------
# Install Mayros
# ---------------------------------------------------------------------------

function Install-Mayros {
    Write-Info "Installing @apilium/mayros globally..."
    & npm install -g @apilium/mayros
    Write-Ok "@apilium/mayros installed"
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

function Test-Installation {
    $mayrosCmd = Get-Command mayros -ErrorAction SilentlyContinue
    if (-not $mayrosCmd) {
        Write-Warn "mayros not found in PATH. You may need to restart your shell."
        Write-Warn "Try: mayros --version"
        return
    }

    $ver = & mayros --version 2>$null
    Write-Ok "Mayros $ver is ready"
    Write-Host ""
    Write-Host "Get started:" -NoNewline -ForegroundColor White
    Write-Host ""
    Write-Host "  mayros onboard    # First-time setup"
    Write-Host "  mayros code       # Start coding session"
    Write-Host ""
    Write-Host "Docs: https://apilium.com/us/doc/mayros" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Mayros Installer" -ForegroundColor Cyan
Write-Host ""

$arch = Get-Platform
Write-Info "Detected windows_$arch"

$nodeOk = Test-Node

if (-not $nodeOk) {
    Install-NodeViaFnm
}

Install-Mayros
Test-Installation
