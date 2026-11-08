#!/usr/bin/env bash
# Deploy this checkout (dist + jsx) to the Windows folder AE sessions run kumo from.
#   scripts/deploy-windows.sh            -> %LOCALAPPDATA%\ae_playground\kumo (the live one)
#   scripts/deploy-windows.sh kumo-dev   -> %LOCALAPPDATA%\ae_playground\kumo-dev (staging; seeded from the live folder's node_modules)
# Running MCP servers keep the old code until their session reconnects (/mcp).
set -euo pipefail
cd "$(dirname "$0")/.."
name=${1:-kumo}
base=/mnt/c/Users/ran/AppData/Local/ae_playground
dest=$base/$name
[ -d "$base/kumo/node_modules" ] || { echo "no live kumo folder at $base/kumo"; exit 1; }
npm run build >/dev/null
if [ ! -d "$dest" ]; then mkdir -p "$dest"; cp -r "$base/kumo/node_modules" "$base/kumo/package.json" "$dest/"; fi
rm -rf "$dest/dist" "$dest/jsx"
cp -r dist jsx "$dest/"
echo "deployed to $dest (windows: C:\\Users\\ran\\AppData\\Local\\ae_playground\\$name\\dist\\index.js)"
