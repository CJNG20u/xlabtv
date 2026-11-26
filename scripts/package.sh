#!/bin/sh
# Builds xlab-tv.tar.gz: everything install.sh needs, with the UI already built (dist/),
# so a TV box needs neither git nor Node.js. Run from the repo root after "npm run build".
set -eu
[ -f dist/index.html ] || { echo "build the UI first (npm run build)" >&2; exit 1; }
version="${1:-$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD)}"
out=$(mktemp -d)/xlab-tv
mkdir -p "$out"
cp -r install.sh get.sh uninstall.sh apps.example.json README.md xlabtv session gnome-extension dist "$out/"
rm -rf "$out/xlabtv/__pycache__"
echo "$version" > "$out/VERSION"
tar -czf xlab-tv.tar.gz -C "$(dirname "$out")" xlab-tv
echo "$version" > VERSION
echo "xlab-tv.tar.gz $(du -h xlab-tv.tar.gz | cut -f1) (version $version)"
