; Mayros Windows Installer — NSIS Script
; Installs Node.js portable + Cortex binary, then runs npm install for Mayros

!ifndef MAYROS_VERSION
  !define MAYROS_VERSION "0.3.1"
!endif
!ifndef NODE_VERSION
  !define NODE_VERSION "22"
!endif
!ifndef CORTEX_VERSION
  !define CORTEX_VERSION "0.6.3"
!endif

; ---------------------------------------------------------------------------
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Mayros ${MAYROS_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Mayros is an open-source AI agent framework.$\r$\n$\r$\nThis installer will set up:$\r$\n  - Node.js ${NODE_VERSION} (portable)$\r$\n  - AIngle Cortex ${CORTEX_VERSION} (semantic memory)$\r$\n  - Mayros CLI and Gateway$\r$\n$\r$\nClick Next to continue."

Name "Mayros ${MAYROS_VERSION}"
OutFile "${OUTPUT_DIR}\mayros-${MAYROS_VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Mayros"
RequestExecutionLevel user

; ---------------------------------------------------------------------------
; Pages
; ---------------------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGING_DIR}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Mayros Dashboard"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchDashboard"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Install section
; ---------------------------------------------------------------------------
Section "Mayros" SecMain
  SetOutPath "$INSTDIR"

  ; --- Node.js portable ---
  DetailPrint "Installing Node.js ${NODE_VERSION}..."
  File /r "${STAGING_DIR}\node"

  ; --- Cortex binary ---
  DetailPrint "Installing AIngle Cortex ${CORTEX_VERSION}..."
  SetOutPath "$INSTDIR\bin"
  File "${STAGING_DIR}\bin\aingle-cortex.exe"

  ; --- Scripts (npm creates mayros.cmd automatically) ---
  SetOutPath "$INSTDIR"
  File "${STAGING_DIR}\install-mayros.cmd"
  File "${STAGING_DIR}\LICENSE"

  SetOutPath "$INSTDIR\bin"
  File "${STAGING_DIR}\bin\open-portal.cmd"

  ; --- Install Mayros via npm ---
  DetailPrint "Installing Mayros ${MAYROS_VERSION} via npm (this may take a minute)..."
  SetOutPath "$INSTDIR"
  nsExec::ExecToLog '"$INSTDIR\install-mayros.cmd"'

  ; --- Add to user PATH ---
  DetailPrint "Adding Mayros to user PATH..."
  ReadRegStr $0 HKCU "Environment" "Path"
  ; Check if already in PATH
  ${WordFind} $0 "$INSTDIR" "E+1{" $1
  IfErrors 0 +3
    StrCpy $0 "$0;$INSTDIR;$INSTDIR\bin"
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=500

  ; --- Registry ---
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "DisplayName" "Mayros ${MAYROS_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "Publisher" "Apilium Technologies"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "DisplayVersion" "${MAYROS_VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "NoRepair" 1

  ; --- Start Menu shortcut ---
  CreateDirectory "$SMPROGRAMS\Mayros"
  CreateShortcut "$SMPROGRAMS\Mayros\Mayros Dashboard.lnk" \
    "$INSTDIR\node\node.exe" \
    '"$INSTDIR\bin\open-portal.cmd"' \
    "" "" "" "" "Open Mayros Control Dashboard"
  CreateShortcut "$SMPROGRAMS\Mayros\Uninstall Mayros.lnk" "$INSTDIR\uninstall.exe"

  ; --- Uninstaller ---
  WriteUninstaller "$INSTDIR\uninstall.exe"

  DetailPrint "Installation complete!"
SectionEnd

; ---------------------------------------------------------------------------
; Uninstall section
; ---------------------------------------------------------------------------
Section "Uninstall"
  DetailPrint "Stopping Mayros gateway..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\node\node_modules\npm\bin\npx-cli.js" mayros gateway stop'

  ; Remove PATH entries
  ReadRegStr $0 HKCU "Environment" "Path"
  ${WordReplace} $0 ";$INSTDIR\bin" "" "+" $0
  ${WordReplace} $0 ";$INSTDIR" "" "+" $0
  ${WordReplace} $0 "$INSTDIR\bin;" "" "+" $0
  ${WordReplace} $0 "$INSTDIR;" "" "+" $0
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=500

  ; Remove shortcuts
  RMDir /r "$SMPROGRAMS\Mayros"
  Delete "$DESKTOP\Mayros Dashboard.lnk"

  ; Remove registry
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros"

  ; Remove install directory
  RMDir /r "$INSTDIR"

  DetailPrint "Mayros uninstalled. Cortex data in ~/.aingle may be preserved."
SectionEnd

; ---------------------------------------------------------------------------
; Functions
; ---------------------------------------------------------------------------
Function LaunchDashboard
  ExecShell "open" "http://127.0.0.1:18789"
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\Mayros Dashboard.lnk" \
    "$INSTDIR\node\node.exe" \
    '"$INSTDIR\bin\open-portal.cmd"' \
    "" "" "" "" "Open Mayros Control Dashboard"
FunctionEnd
