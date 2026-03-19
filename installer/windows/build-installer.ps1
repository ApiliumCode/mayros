# build-installer.ps1
# Builds the Mayros Windows installer (.exe) using NSIS
# Usage: .\build-installer.ps1 [-SkipDownload] [-SignCert <path>]

param(
    [switch]$SkipDownload,
    [string]$SignCert = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$InstallerDir = Split-Path -Parent $ScriptDir
$SharedDir = Join-Path $InstallerDir "shared"
$AssetsDir = Join-Path $InstallerDir "assets"
$BuildDir = Join-Path $ScriptDir "build"
$DepsDir = Join-Path $BuildDir "deps"
$OutputDir = Join-Path $ScriptDir "output"

$Manifest = Get-Content (Join-Path $SharedDir "bundle-manifest.json") | ConvertFrom-Json
$MayrosVersion = $Manifest.mayros
$NodeVersion = $Manifest.node
$CortexVersion = $Manifest.cortex
$NodeFile = $Manifest.platforms."windows-x64".node
$CortexFile = $Manifest.platforms."windows-x64".cortex

Write-Host "==> Mayros $MayrosVersion Windows Installer Builder" -ForegroundColor Cyan
Write-Host "    Node.js $NodeVersion | Cortex $CortexVersion"
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Download dependencies
# ---------------------------------------------------------------------------
if (-not $SkipDownload) {
    New-Item -ItemType Directory -Force -Path $DepsDir | Out-Null

    Write-Host "==> Downloading dependencies..." -ForegroundColor Yellow

    # Node.js
    $nodeUrl = "https://nodejs.org/dist/v${NodeVersion}/${NodeFile}"
    $nodeDest = Join-Path $DepsDir $NodeFile
    if (-not (Test-Path $nodeDest)) {
        Write-Host "  -> $nodeUrl"
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeDest -UseBasicParsing
    } else {
        Write-Host "  -> Node.js already downloaded"
    }

    # Cortex
    $cortexUrl = "https://github.com/ApiliumCode/aingle/releases/download/v${CortexVersion}/${CortexFile}"
    $cortexDest = Join-Path $DepsDir $CortexFile
    if (-not (Test-Path $cortexDest)) {
        Write-Host "  -> $cortexUrl"
        Invoke-WebRequest -Uri $cortexUrl -OutFile $cortexDest -UseBasicParsing
    } else {
        Write-Host "  -> Cortex already downloaded"
    }

    # Mayros npm tarball
    $mayrosTarball = Join-Path $DepsDir "apilium-mayros-${MayrosVersion}.tgz"
    if (-not (Test-Path $mayrosTarball)) {
        Write-Host "  -> npm pack @apilium/mayros@${MayrosVersion}"
        Push-Location $DepsDir
        npm pack "@apilium/mayros@${MayrosVersion}" --quiet 2>$null
        Pop-Location
    } else {
        Write-Host "  -> Mayros tarball already downloaded"
    }
} else {
    Write-Host "==> Skipping download (--SkipDownload)" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Extract dependencies into staging area
# ---------------------------------------------------------------------------
$StageDir = Join-Path $BuildDir "staging"
Write-Host "==> Preparing staging directory..." -ForegroundColor Yellow

if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Extract Node.js
Write-Host "  -> Extracting Node.js..."
Expand-Archive -Path (Join-Path $DepsDir $NodeFile) -DestinationPath $StageDir -Force
$nodeExtracted = Get-ChildItem -Path $StageDir -Directory | Where-Object { $_.Name -match "node-v" } | Select-Object -First 1
Rename-Item $nodeExtracted.FullName (Join-Path $StageDir "node")

# Extract Cortex
Write-Host "  -> Extracting Cortex..."
$binDir = Join-Path $StageDir "bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Expand-Archive -Path (Join-Path $DepsDir $CortexFile) -DestinationPath $binDir -Force

# Extract Mayros CLI
Write-Host "  -> Extracting Mayros CLI..."
$cliDir = Join-Path $StageDir "cli"
New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
$tarball = Get-ChildItem -Path $DepsDir -Filter "*.tgz" | Select-Object -First 1
if ($tarball) {
    tar -xzf $tarball.FullName -C $cliDir --strip-components=1
}

# Copy wrapper scripts
Write-Host "  -> Copying wrapper scripts..."
Copy-Item (Join-Path $ScriptDir "mayros.cmd") $StageDir
Copy-Item (Join-Path $ScriptDir "open-portal.cmd") (Join-Path $StageDir "bin")

# ---------------------------------------------------------------------------
# 3. Ensure NSIS is available
# ---------------------------------------------------------------------------
$nsisExe = ""
$nsisSearchPaths = @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe",
    (Join-Path $BuildDir "nsis\makensis.exe")
)

foreach ($path in $nsisSearchPaths) {
    if (Test-Path $path) {
        $nsisExe = $path
        break
    }
}

if (-not $nsisExe) {
    Write-Host "==> NSIS not found. Downloading portable NSIS..." -ForegroundColor Yellow
    $nsisZipUrl = "https://sourceforge.net/projects/nsis/files/NSIS%203/3.10/nsis-3.10.zip/download"
    $nsisZip = Join-Path $BuildDir "nsis.zip"
    Invoke-WebRequest -Uri $nsisZipUrl -OutFile $nsisZip -UseBasicParsing
    Expand-Archive -Path $nsisZip -DestinationPath $BuildDir -Force
    $nsisDir = Get-ChildItem -Path $BuildDir -Directory | Where-Object { $_.Name -match "nsis" } | Select-Object -First 1
    Rename-Item $nsisDir.FullName (Join-Path $BuildDir "nsis")
    $nsisExe = Join-Path $BuildDir "nsis\makensis.exe"
    Remove-Item $nsisZip -Force
}

Write-Host "  -> Using NSIS: $nsisExe"

# ---------------------------------------------------------------------------
# 4. Run NSIS compiler
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$nsiScript = Join-Path $ScriptDir "mayros-setup.nsi"
Write-Host "==> Compiling installer..." -ForegroundColor Yellow

& $nsisExe `
    /DMAYROS_VERSION=$MayrosVersion `
    /DNODE_VERSION=$NodeVersion `
    /DCORTEX_VERSION=$CortexVersion `
    /DSTAGING_DIR=$StageDir `
    /DASSETS_DIR=$AssetsDir `
    /DOUTPUT_DIR=$OutputDir `
    $nsiScript

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: NSIS compilation failed" -ForegroundColor Red
    exit 1
}

$installerPath = Join-Path $OutputDir "mayros-${MayrosVersion}-setup.exe"
Write-Host "==> Installer built: $installerPath" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Sign the executable (optional)
# ---------------------------------------------------------------------------
if ($SignCert -and (Test-Path $SignCert)) {
    Write-Host "==> Signing installer..." -ForegroundColor Yellow
    $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
    if (Test-Path $signtool) {
        & $signtool sign /f $SignCert /tr http://timestamp.digicert.com /td sha256 /fd sha256 $installerPath
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  -> Signed successfully" -ForegroundColor Green
        } else {
            Write-Host "  -> Signing failed (non-fatal)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  -> signtool.exe not found, skipping" -ForegroundColor Yellow
    }
} elseif ($SignCert) {
    Write-Host "  -> Certificate not found at: $SignCert" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==> Build complete!" -ForegroundColor Green
Write-Host "    Output: $installerPath"
Write-Host "    Size:   $([math]::Round((Get-Item $installerPath).Length / 1MB, 2)) MB"
