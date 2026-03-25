# Mayros Installer Infrastructure

Cross-platform installer build scripts for Mayros v0.3.1.

## Directory Structure

```
installer/
├── shared/
│   ├── brand.json              # Brand colors, versions, URLs
│   ├── bundle-manifest.json    # Platform-specific dependency filenames
│   └── download-deps.sh        # Cross-platform dependency downloader
├── assets/
│   ├── mayros-logo.svg         # Vector logo
│   ├── mayros.ico              # Windows icon (required for NSIS)
│   ├── mayros.icns             # macOS icon (required for DMG)
│   └── mayros.png              # PNG icon (used in AppImage/deb)
├── windows/
│   ├── build-installer.ps1     # Build script (produces .exe)
│   ├── mayros-setup.nsi        # NSIS installer definition
│   ├── mayros.cmd              # PATH wrapper
│   └── open-portal.cmd         # Desktop shortcut target
├── macos/
│   └── build-dmg.sh            # Build script (produces .dmg)
├── linux/
│   ├── build-appimage.sh       # Build script (produces .AppImage)
│   ├── build-deb.sh            # Build script (produces .deb)
│   └── mayros.desktop          # XDG desktop entry
└── README.md
```

## Prerequisites

### All Platforms

- `curl` or `wget`
- `python3` or `node` (for manifest parsing)
- `npm` (for downloading the Mayros CLI package)

### Windows

- PowerShell 5.1+
- NSIS 3.x (auto-downloaded if not installed)
- Optional: signtool.exe for code signing

### macOS

- Xcode Command Line Tools (`xcode-select --install`)
- Optional: `create-dmg` (`brew install create-dmg`) for styled DMG
- Optional: Apple Developer certificate for codesigning

### Linux (AppImage)

- `tar`, `xz-utils`
- `appimagetool` (auto-downloaded if not present)
- Optional: `rsvg-convert` or ImageMagick for SVG-to-PNG icon conversion

### Linux (deb)

- `dpkg-deb`
- `tar`, `xz-utils`

## Build Commands

### Windows Installer (.exe)

```powershell
cd installer\windows
.\build-installer.ps1

# With code signing:
.\build-installer.ps1 -SignCert "C:\path\to\certificate.pfx"

# Skip dependency download (if already cached):
.\build-installer.ps1 -SkipDownload
```

Output: `installer/windows/output/mayros-0.3.1-setup.exe`

### macOS DMG

```bash
cd installer/macos
./build-dmg.sh

# With codesigning:
./build-dmg.sh --sign "Developer ID Application: Apilium Technologies"
```

Output: `installer/macos/output/Mayros-0.3.1.dmg`

### Linux AppImage

```bash
cd installer/linux
./build-appimage.sh

# For ARM64:
./build-appimage.sh --arch arm64
```

Output: `installer/linux/output/Mayros-0.3.1-x86_64.AppImage`

### Linux .deb Package

```bash
cd installer/linux
./build-deb.sh

# For ARM64:
./build-deb.sh --arch arm64
```

Output: `installer/linux/output/mayros_0.3.1_amd64.deb`

## Bundled Components

Each installer packages three components:

| Component       | Version | Source                                |
|-----------------|---------|---------------------------------------|
| Mayros CLI      | 0.3.1   | npm: `@apilium/mayros`                |
| Node.js         | 22.16.0 | nodejs.org (portable/binary)          |
| AIngle Cortex   | 0.6.3   | GitHub: `ApiliumCode/aingle` releases  |

## What the Installers Do

1. Extract Node.js portable runtime (no system-wide install)
2. Extract Mayros CLI package
3. Place AIngle Cortex binary
4. Create PATH wrapper so `mayros` is available in terminal
5. Run `mayros onboard --non-interactive --defaults` for initial setup
6. Start the gateway daemon (platform-appropriate method)
7. Create desktop/menu shortcuts pointing to the portal

## Distribution Notes

- Windows: the .exe can be distributed directly or via WinGet/Chocolatey
- macOS: the .dmg should be notarized for Gatekeeper (`xcrun notarytool`)
- Linux AppImage: single-file portable, no installation needed
- Linux deb: installs to `/opt/mayros/`, integrates with systemd
- All installers are user-space (no admin/root required for Windows/macOS/AppImage)
