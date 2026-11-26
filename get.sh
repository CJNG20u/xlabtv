#!/bin/sh
# Installs or updates xLab TV from the latest ready-made package (no git or Node.js needed):
#   wget -qO- https://github.com/CJNG20u/xlabtv/releases/download/latest/get.sh | sh
#   ... | sh -s -- --autologin        (also log in automatically)
set -eu
BASE=https://github.com/CJNG20u/xlabtv/releases/download/latest
DIR=${XDG_DATA_HOME:-$HOME/.local/share}/xlab-tv-source
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "==> Downloading the latest xLab TV"
if command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp/xlab-tv.tar.gz" "$BASE/xlab-tv.tar.gz"
else
    curl -fsSL -o "$tmp/xlab-tv.tar.gz" "$BASE/xlab-tv.tar.gz"
fi
tar -xzf "$tmp/xlab-tv.tar.gz" -C "$tmp"
[ -f "$tmp/xlab-tv/install.sh" ] || { echo "The download looks broken; nothing was changed." >&2; exit 1; }

# keep the unpacked copy: the Updates tile and the update check use it
rm -rf "$DIR.old"
[ -d "$DIR" ] && mv "$DIR" "$DIR.old"
mkdir -p "$(dirname "$DIR")"
mv "$tmp/xlab-tv" "$DIR"
rm -rf "$DIR.old"
echo "==> Version $(cat "$DIR/VERSION")"
cd "$DIR" && sh install.sh "$@"
