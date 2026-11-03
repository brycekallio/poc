#!/usr/bin/env bash
# Build dist/POC.app from the Swift package. Same shape as Shifter's build.sh:
# compile, hand-write Info.plist, make the icon, sign, register with Launch Services.
#
# Signing: macOS ties the Accessibility permission to the app's signature. An ad-hoc signature
# changes on every build, so every rebuild would ask for Accessibility again. A free self-signed
# certificate named "POC Dev" (see scripts/make-dev-cert.sh) keeps the identity stable. No Apple
# Developer account is involved or wanted (Bryce, 2026-11-02).
set -euo pipefail
cd "$(dirname "$0")"

# iCloud Desktop & Documents sync stamps files with extended attributes that codesign rejects
# ("detritus not allowed"). A .nosync folder is ignored by iCloud; dist is a symlink to it.
VERSION=0.2.0
if [ ! -L dist ]; then rm -rf dist; mkdir -p dist.nosync; ln -s dist.nosync dist; fi
APP=dist/POC.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/fonts"

swift build -c release --arch arm64
cp .build/arm64-apple-macosx/release/POCApp "$APP/Contents/MacOS/POC"

# The coaching engine: the extension's own JS, bundled for a web view by `npm run build` in ../extension.
if [ ! -f Resources/web/engine.js ]; then (cd ../extension && npm run build >/dev/null); fi
cp -R Resources/web "$APP/Contents/Resources/web"

# Geist (SIL OFL 1.1), the extension's typeface; licence travels with it.
GEIST=../extension/node_modules/geist
if [ -d "$GEIST" ]; then
  for w in Regular Medium SemiBold; do cp "$GEIST/dist/fonts/geist-sans/Geist-$w.ttf" "$APP/Contents/Resources/fonts/"; done
  cp "$GEIST/LICENSE.txt" "$APP/Contents/Resources/fonts/OFL.txt"
else
  echo "  note: run 'npm install' in ../extension to bundle Geist; falling back to the system font"
fi

# Icon: the extension's own logo (static/icons/icon.svg) rendered at 1024 px.
ICONSET="$(mktemp -d)/POC.iconset"; mkdir -p "$ICONSET"
if (cd ../extension && node -e '
  import("sharp").then(async ({default: sharp}) => {
    await sharp("static/icons/icon.svg", {density: 1152}).resize(1024, 1024).png().toFile(process.argv[1]);
  })' "$ICONSET/icon_512x512@2x.png") 2>/dev/null; then
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/POC.icns"
else
  echo "  note: could not render the icon (needs ../extension/node_modules); app builds without one"
fi
rm -rf "$(dirname "$ICONSET")"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>POC</string>
  <key>CFBundleDisplayName</key><string>POC</string>
  <key>CFBundleIdentifier</key><string>com.brycekallio.poc</string>
  <key>CFBundleExecutable</key><string>POC</string>
  <key>CFBundleIconFile</key><string>POC</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- The engine web view calls the model over plain http: Ollama and LM Studio run on localhost,
       and an "Other" server may sit on the local network. HTTPS providers are unaffected. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict>
</plist>
PLIST

xattr -cr "$APP"
IDENTITY="${POC_SIGN_IDENTITY:-POC Dev}"
KC="$HOME/Library/Keychains/poc-dev.keychain-db"
[ -f "$KC" ] && security unlock-keychain -p poc-dev "$KC" 2>/dev/null || true
if security find-identity -p codesigning | grep -q "\"$IDENTITY\""; then
  codesign --force --sign "$IDENTITY" "$APP"
  echo "  signed with '$IDENTITY' (stable identity: Accessibility stays granted across rebuilds)"
else
  codesign --force --sign - "$APP"
  echo "  signed ad hoc: Accessibility must be re-granted after every rebuild. Run scripts/make-dev-cert.sh once to fix that."
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "  built $APP"
