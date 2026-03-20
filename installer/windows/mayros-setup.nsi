; mayros-setup.nsi
; NSIS installer script for Mayros
; Compile: makensis /DMAYROS_VERSION=x.y.z /DSTAGING_DIR=... mayros-setup.nsi

; ---------------------------------------------------------------------------
; Build-time defines (passed via /D flags from build-installer.ps1)
; ---------------------------------------------------------------------------
!ifndef MAYROS_VERSION
  !define MAYROS_VERSION "0.3.1"
!endif
!ifndef NODE_VERSION
  !define NODE_VERSION "22.16.0"
!endif
!ifndef CORTEX_VERSION
  !define CORTEX_VERSION "0.6.3"
!endif
!ifndef STAGING_DIR
  !define STAGING_DIR "build\staging"
!endif
!ifndef ASSETS_DIR
  !define ASSETS_DIR "..\assets"
!endif
!ifndef OUTPUT_DIR
  !define OUTPUT_DIR "output"
!endif

; ---------------------------------------------------------------------------
; General
; ---------------------------------------------------------------------------
Name "Mayros ${MAYROS_VERSION}"
OutFile "${OUTPUT_DIR}\mayros-${MAYROS_VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Mayros"
InstallDirRegKey HKCU "Software\Mayros" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Unicode True

; ---------------------------------------------------------------------------
; MUI2 Configuration
; ---------------------------------------------------------------------------
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Mayros ${MAYROS_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install Mayros ${MAYROS_VERSION} on your computer.$\r$\n$\r$\nMayros includes:$\r$\n  - Mayros CLI v${MAYROS_VERSION}$\r$\n  - Node.js v${NODE_VERSION} (portable)$\r$\n  - AIngle Cortex v${CORTEX_VERSION}$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\open-portal.cmd"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Mayros Portal"
!define MUI_FINISHPAGE_LINK "Visit mayros.apilium.com"
!define MUI_FINISHPAGE_LINK_LOCATION "https://mayros.apilium.com"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGING_DIR}\..\..\..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"

; ---------------------------------------------------------------------------
; Version info
; ---------------------------------------------------------------------------
VIProductVersion "${MAYROS_VERSION}.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "Mayros"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${MAYROS_VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "Apilium Technologies"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Apilium Technologies"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "Mayros Installer"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${MAYROS_VERSION}.0"

; ---------------------------------------------------------------------------
; Install Section
; ---------------------------------------------------------------------------
Section "Mayros Core" SecCore
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; --- Node.js portable ---
  SetOutPath "$INSTDIR\node"
  File /r "${STAGING_DIR}\node\*.*"

  ; --- Mayros CLI ---
  SetOutPath "$INSTDIR\cli"
  File /r "${STAGING_DIR}\cli\*.*"

  ; --- Cortex binary ---
  SetOutPath "$INSTDIR\bin"
  File /r "${STAGING_DIR}\bin\*.*"

  ; --- Wrapper scripts ---
  SetOutPath "$INSTDIR"
  File "${STAGING_DIR}\mayros.cmd"

  SetOutPath "$INSTDIR\bin"
  File "${STAGING_DIR}\bin\open-portal.cmd"

  ; --- Install npm dependencies ---
  SetOutPath "$INSTDIR\cli"
  DetailPrint "Installing CLI dependencies..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\node\npm" install --omit=dev --prefix "$INSTDIR\cli"'

  ; --- Add to user PATH ---
  DetailPrint "Adding Mayros to user PATH..."
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $0 "$0;$INSTDIR;$INSTDIR\bin"
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=500

  ; --- Write registry info ---
  WriteRegStr HKCU "Software\Mayros" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Mayros" "Version" "${MAYROS_VERSION}"

  ; --- Uninstaller ---
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; --- Add/Remove Programs entry ---
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "DisplayName" "Mayros ${MAYROS_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "DisplayIcon" "$INSTDIR\bin\mayros.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "Publisher" "Apilium Technologies"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "DisplayVersion" "${MAYROS_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "URLInfoAbout" "https://mayros.apilium.com"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "NoRepair" 1

  ; --- Compute installed size ---
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros" \
    "EstimatedSize" "$0"

SectionEnd

; ---------------------------------------------------------------------------
; Post-install: onboard + shortcuts
; ---------------------------------------------------------------------------
Section "-PostInstall"
  ; Run onboarding
  DetailPrint "Running initial setup..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\cli\dist\index.js" onboard --non-interactive --defaults --install-daemon'

  ; --- Start Menu shortcuts ---
  CreateDirectory "$SMPROGRAMS\Mayros"
  CreateShortcut "$SMPROGRAMS\Mayros\Mayros Portal.lnk" \
    "$INSTDIR\bin\open-portal.cmd" "" "$INSTDIR\bin\mayros.ico"
  CreateShortcut "$SMPROGRAMS\Mayros\Mayros Terminal.lnk" \
    "$WINDIR\system32\cmd.exe" '/k "$INSTDIR\mayros.cmd"' "$INSTDIR\bin\mayros.ico"
  CreateShortcut "$SMPROGRAMS\Mayros\Uninstall Mayros.lnk" \
    "$INSTDIR\uninstall.exe"

  ; --- Desktop shortcut ---
  CreateShortcut "$DESKTOP\Mayros Portal.lnk" \
    "$INSTDIR\bin\open-portal.cmd" "" "$INSTDIR\bin\mayros.ico"
SectionEnd

; ---------------------------------------------------------------------------
; Uninstall Section
; ---------------------------------------------------------------------------
Section "Uninstall"
  ; Run mayros uninstall first
  DetailPrint "Running Mayros cleanup..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\cli\dist\index.js" uninstall --all --yes --non-interactive'

  ; Remove PATH entries
  ReadRegStr $0 HKCU "Environment" "Path"
  ${WordReplace} $0 ";$INSTDIR\bin" "" "+" $0
  ${WordReplace} $0 ";$INSTDIR" "" "+" $0
  ${WordReplace} $0 "$INSTDIR\bin;" "" "+" $0
  ${WordReplace} $0 "$INSTDIR;" "" "+" $0
  ${WordReplace} $0 "$INSTDIR\bin" "" "+" $0
  ${WordReplace} $0 "$INSTDIR" "" "+" $0
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=500

  ; Remove shortcuts
  Delete "$DESKTOP\Mayros Portal.lnk"
  RMDir /r "$SMPROGRAMS\Mayros"

  ; Remove install directory
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\cli"
  RMDir /r "$INSTDIR\bin"
  Delete "$INSTDIR\mayros.cmd"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; Remove registry
  DeleteRegKey HKCU "Software\Mayros"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Mayros"
SectionEnd
