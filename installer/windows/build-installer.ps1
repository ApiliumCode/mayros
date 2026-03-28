# build-installer.ps1
# Builds the Mayros Windows installer (.exe) using NSIS
# Strategy: bundle Node.js portable + Cortex binary. At install time,
# npm install -g @apilium/mayros — fast, no long path issues.

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
# 1. Download Node.js + Cortex only (Mayros installed at runtime via npm)
# ---------------------------------------------------------------------------
if (-not $SkipDownload) {
    New-Item -ItemType Directory -Force -Path $DepsDir | Out-Null
    Write-Host "==> Downloading dependencies..." -ForegroundColor Yellow

    $nodeUrl = "https://nodejs.org/dist/v${NodeVersion}/${NodeFile}"
    $nodeDest = Join-Path $DepsDir $NodeFile
    if (-not (Test-Path $nodeDest)) {
        Write-Host "  -> Downloading Node.js $NodeVersion..."
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeDest -UseBasicParsing
    } else {
        Write-Host "  -> Node.js already downloaded"
    }

    $cortexUrl = "https://github.com/ApiliumCode/aingle/releases/download/v${CortexVersion}/${CortexFile}"
    $cortexDest = Join-Path $DepsDir $CortexFile
    if (-not (Test-Path $cortexDest)) {
        Write-Host "  -> Downloading Cortex $CortexVersion..."
        Invoke-WebRequest -Uri $cortexUrl -OutFile $cortexDest -UseBasicParsing
    } else {
        Write-Host "  -> Cortex already downloaded"
    }
} else {
    Write-Host "==> Skipping download (--SkipDownload)" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Prepare staging: Node.js portable + Cortex + wrapper scripts
# ---------------------------------------------------------------------------
$StageDir = Join-Path $BuildDir "staging"
Write-Host "==> Preparing staging directory..." -ForegroundColor Yellow

if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Extract Node.js portable
Write-Host "  -> Extracting Node.js..."
Expand-Archive -Path (Join-Path $DepsDir $NodeFile) -DestinationPath $StageDir -Force
$nodeDir = Get-ChildItem -Path $StageDir -Directory | Where-Object { $_.Name -match "node-v" } | Select-Object -First 1
Rename-Item $nodeDir.FullName (Join-Path $StageDir "node")

# Extract Cortex binary
Write-Host "  -> Extracting Cortex..."
$binDir = Join-Path $StageDir "bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Expand-Archive -Path (Join-Path $DepsDir $CortexFile) -DestinationPath $binDir -Force
# Rename platform-suffixed binary
$cortexBin = Get-ChildItem -Path $binDir -Filter "aingle-cortex*" | Select-Object -First 1
if ($cortexBin -and $cortexBin.Name -ne "aingle-cortex.exe") {
    Rename-Item $cortexBin.FullName (Join-Path $binDir "aingle-cortex.exe")
    Write-Host "  -> Renamed $($cortexBin.Name) -> aingle-cortex.exe"
}

# Copy wrapper scripts
Write-Host "  -> Copying wrapper scripts..."
Copy-Item (Join-Path $ScriptDir "mayros.cmd") $StageDir
Copy-Item (Join-Path $ScriptDir "open-portal.cmd") $binDir

# Copy LICENSE from repo root
$repoRoot = Split-Path -Parent $InstallerDir
if (Test-Path (Join-Path $repoRoot "LICENSE")) {
    Copy-Item (Join-Path $repoRoot "LICENSE") $StageDir
}

# Create install.cmd — runs npm install at install time, starts services, opens portal
$installCmd = @"
@echo off
set "MAYROS_DIR=%LOCALAPPDATA%\Mayros"
set "PATH=%MAYROS_DIR%\node;%PATH%"
echo.
echo ===================================
echo   Installing Mayros...
echo   This may take a minute.
echo ===================================
echo.
:: Locate npm.cmd — try portable node root first, then nested path
set "NPM_CMD=%MAYROS_DIR%\node\npm.cmd"
if not exist "%NPM_CMD%" set "NPM_CMD=%MAYROS_DIR%\node\node_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CMD%" (
    echo ERROR: npm not found in portable Node.js directory.
    echo Expected: %MAYROS_DIR%\node\npm.cmd
    exit /b 1
)
call "%NPM_CMD%" install -g @apilium/mayros@latest --prefix "%MAYROS_DIR%" --force --no-fund --no-audit
if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Please check your network connection
    echo and try running this command manually:
    echo   "%NPM_CMD%" install -g @apilium/mayros@latest --prefix "%MAYROS_DIR%"
    exit /b 1
)
echo Configuring Mayros for first use...
:: Minimal config: gateway.mode=local + auth.mode=none (portal wizard configures auth later)
set "CONFIG_FILE=%MAYROS_DIR%\mayros.json"
"%MAYROS_DIR%\node\node.exe" -e "const fs=require('fs');const p=require('path');const f=p.join(process.env.LOCALAPPDATA,'Mayros','mayros.json');let c={};try{c=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}if(!c.gateway)c.gateway={};if(!c.gateway.mode)c.gateway.mode='local';if(!c.gateway.auth)c.gateway.auth={};c.gateway.auth.mode='none';fs.writeFileSync(f,JSON.stringify(c,null,2)+'\n');" 2>nul
if errorlevel 1 (
    echo {"gateway":{"mode":"local","auth":{"mode":"none"}}} > "%CONFIG_FILE%"
)
:: Bootstrap workspace templates
set "TEMPLATES=%MAYROS_DIR%\lib\node_modules\@apilium\mayros\docs\reference\templates"
set "WORKSPACE=%MAYROS_DIR%\workspace"
if exist "%TEMPLATES%" (
    if not exist "%WORKSPACE%" mkdir "%WORKSPACE%"
    for %%F in (AGENTS.md MAYROS.md TOOLS.md IDENTITY.md USER.md HOPE.md BOOTSTRAP.md) do (
        if exist "%TEMPLATES%\%%F" if not exist "%WORKSPACE%\%%F" copy "%TEMPLATES%\%%F" "%WORKSPACE%\%%F" >nul
    )
    if not exist "%WORKSPACE%\MEMORY.md" echo # Memory > "%WORKSPACE%\MEMORY.md"
)
echo.
echo Starting Cortex...
start "" "%MAYROS_DIR%\bin\aingle-cortex.exe" --port 19090
:: Wait for Cortex to be ready before starting gateway
echo Waiting for Cortex to be ready...
set CORTEX_TRIES=0
:cortexwait
if %CORTEX_TRIES% GEQ 20 goto startgateway
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:19090/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto startgateway
set /a CORTEX_TRIES+=1
timeout /t 1 /nobreak >nul
goto cortexwait
:startgateway
echo Starting Gateway...
start "" "%MAYROS_DIR%\mayros.cmd" gateway start
echo Waiting for gateway to be ready...
set TRIES=0
:waitloop
if %TRIES% GEQ 30 goto openbrowser
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:18789/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto openbrowser
set /a TRIES+=1
timeout /t 1 /nobreak >nul
goto waitloop
:openbrowser
echo Opening Mayros Dashboard...
start http://127.0.0.1:18789
echo.
echo ===================================
echo   Mayros installed successfully!
echo   You can now use 'mayros' from
echo   any terminal (restart terminal first).
echo ===================================
"@
Set-Content -Path (Join-Path $StageDir "install-mayros.cmd") -Value $installCmd -Encoding ASCII

Write-Host "  -> Staging complete" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Find NSIS
# ---------------------------------------------------------------------------
$nsisExe = ""
foreach ($path in @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe"
)) {
    if (Test-Path $path) { $nsisExe = $path; break }
}
if (-not $nsisExe) {
    Write-Host "ERROR: NSIS not found. Install with: winget install NSIS.NSIS" -ForegroundColor Red
    exit 1
}
Write-Host "  -> NSIS: $nsisExe"

# ---------------------------------------------------------------------------
# 4. Compile NSIS installer
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

# ---------------------------------------------------------------------------
# 5. Optional signing
# ---------------------------------------------------------------------------
if ($SignCert -and (Test-Path $SignCert)) {
    Write-Host "==> Signing installer..." -ForegroundColor Yellow
    $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
    if (Test-Path $signtool) {
        & $signtool sign /f $SignCert /tr http://timestamp.digicert.com /td sha256 /fd sha256 $installerPath
    }
}

Write-Host ""
Write-Host "==> Build complete!" -ForegroundColor Green
Write-Host "    Output: $installerPath"
Write-Host "    Size:   $([math]::Round((Get-Item $installerPath).Length / 1MB, 2)) MB"
