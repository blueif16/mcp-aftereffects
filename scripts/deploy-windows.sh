#!/usr/bin/env bash
# Deploy this checkout (dist + jsx) from WSL to a Windows folder that After Effects sessions run kumo from.
#   KUMO_DEPLOY_DIR=/mnt/c/Users/<you>/AppData/Local/kumo scripts/deploy-windows.sh
#   scripts/deploy-windows.sh /mnt/c/Users/<you>/AppData/Local/kumo      (same, path as the argument)
# A new folder gets node_modules and package.json from this checkout (production dependencies only:
# run `npm ci --omit=dev` on the Windows side if a dependency has native parts); an existing one keeps its node_modules.
# Running MCP servers keep the old code until their session reconnects (/mcp).
set -euo pipefail
cd "$(dirname "$0")/.."
dest=${1:-${KUMO_DEPLOY_DIR:-}}
[ -n "$dest" ] || { echo "usage: $0 <install folder, as a /mnt/... path>  (or set KUMO_DEPLOY_DIR)"; exit 2; }
npm run build >/dev/null
if [ ! -d "$dest/node_modules" ]; then mkdir -p "$dest"; cp -r node_modules package.json package-lock.json "$dest/"; fi
rm -rf "$dest/dist" "$dest/jsx"
cp -r dist jsx "$dest/"
echo "deployed to $dest (windows path: $(wslpath -w "$dest" 2>/dev/null || echo "$dest")\\dist\\index.js)"
