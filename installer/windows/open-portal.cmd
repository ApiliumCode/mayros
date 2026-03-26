@echo off
setlocal

set "MAYROS_CMD=%LOCALAPPDATA%\Mayros\mayros.cmd"

:: Start gateway if not running
tasklist /FI "WINDOWTITLE eq Mayros Gateway" 2>nul | find /i "node.exe" >nul
if errorlevel 1 (
    echo Starting Mayros Gateway...
    start /min "" cmd /c "%MAYROS_CMD%" gateway start
)

:: Wait for gateway to be ready (max 30 seconds)
echo Waiting for gateway...
set TRIES=0
:waitloop
if %TRIES% GEQ 30 goto openportal
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:18789/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto openportal
set /a TRIES+=1
timeout /t 1 /nobreak >nul
goto waitloop

:openportal
start http://127.0.0.1:18789
