# Build assets

Drop your icon source here as `icon.png` (square, ideally **1024×1024**).
The build process will generate platform-specific icons automatically.

## How icons are used

| Platform | File required | Notes |
|----------|---------------|-------|
| Linux    | `icon.png`    | Used directly. |
| Windows  | `icon.ico`    | Generate from `icon.png` (see below). |
| macOS    | `icon.icns`   | Generate from `icon.png` (see below). |

## Generate `.ico` and `.icns` from `icon.png`

If you only have `icon.png`, run from the repo root:

```bash
# Requires ImageMagick + (Linux) png2icns or icnsutils
sudo pacman -S imagemagick libicns          # CachyOS / Arch
# Windows ICO (multi-size)
convert assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico
# macOS ICNS
png2icns assets/icon.icns assets/icon.png
```

Alternatively, electron-builder will auto-generate Windows/Mac icons from the
PNG if `.ico`/`.icns` are missing — but explicit files give better quality.

## Build commands

```bash
npm install                # one-time, pulls electron + electron-builder
npm run electron           # dev: launches the game in a window
npm run dist:linux         # builds AppImage + .deb in dist/
npm run dist:win           # builds NSIS installer + portable .exe
npm run dist:mac           # builds .dmg (requires macOS or unsigned cross-build)
npm run dist:all           # all three (Linux + Windows + Mac)
```

Outputs land in `dist/`. The Linux/Windows builds work fine from this CachyOS
box. The unsigned `.dmg` will trigger Gatekeeper warnings on macOS — users
need to right-click → Open the first time.
