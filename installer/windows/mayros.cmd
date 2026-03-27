@echo off
setlocal
set "MAYROS_DIR=%LOCALAPPDATA%\Mayros"
set "NODE=%MAYROS_DIR%\node\node.exe"

:: Try npm global prefix location first (npm --prefix installs here)
set "CLI=%MAYROS_DIR%\lib\node_modules\@apilium\mayros\dist\index.js"
if exist "%CLI%" goto :run

:: Try alternate location (some npm versions)
set "CLI=%MAYROS_DIR%\node_modules\@apilium\mayros\dist\index.js"
if exist "%CLI%" goto :run

:: Try standard npm global (installed via npm install -g)
for /f "delims=" %%i in ('where mayros 2^>nul') do (
    if not "%%i"=="%~f0" (
        "%%i" %*
        exit /b %errorlevel%
    )
)

echo Mayros is not installed. Install with: npm install -g @apilium/mayros
echo Or download the installer from https://mayros.apilium.com
exit /b 1

:run
"%NODE%" "%CLI%" %*
