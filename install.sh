#!/bin/sh
# Installs xLab TV on Ubuntu/Debian. Run from the repo folder as your normal user:
#   ./install.sh                 install, keep the normal login screen
#   ./install.sh --autologin     also boot straight into xLab TV (GDM only)
set -eu

PREFIX=/usr/lib/xlab-tv
USER_NAME=$(id -un)
AUTOLOGIN=0
[ "${1:-}" = "--autologin" ] && AUTOLOGIN=1

if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as your normal user; it asks for sudo when needed." >&2
    exit 1
fi

echo "==> Installing packages"
sudo apt-get update -qq
sudo apt-get install -y python3 cage firefox

echo "==> Copying xLab TV to $PREFIX"
sudo mkdir -p "$PREFIX/xlabtv" "$PREFIX/session" "$PREFIX/ui"
sudo install -m 0644 xlabtv/server.py xlabtv/fallback.html "$PREFIX/xlabtv/"
sudo install -m 0755 session/xlab-tv-kiosk "$PREFIX/session/"
sudo install -m 0644 session/user.js "$PREFIX/session/"
if [ ! -f dist/index.html ]; then
    if command -v npm >/dev/null 2>&1; then
        echo "==> Building the UI"
        npm install --no-audit --no-fund --legacy-peer-deps && npm run build
    else
        echo "    (no npm: install nodejs + npm and re-run to build the UI; using the built-in page for now)"
    fi
fi
if [ -f dist/index.html ]; then
    sudo rm -rf "$PREFIX/ui/dist"
    sudo cp -r dist "$PREFIX/ui/dist"
fi
sudo install -m 0644 session/xlab-tv.desktop /usr/share/wayland-sessions/xlab-tv.desktop

CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}/xlab-tv/apps.json
if [ ! -f "$CONFIG" ]; then
    mkdir -p "$(dirname "$CONFIG")"
    cp apps.example.json "$CONFIG"
    echo "==> Wrote your app list to $CONFIG (edit it to add apps)"
fi
python3 "$PREFIX/xlabtv/server.py" --config "$CONFIG" --check

if [ "$AUTOLOGIN" -eq 1 ]; then
    if [ ! -f /etc/gdm3/custom.conf ]; then
        echo "Auto-login setup supports GDM only; set it up in your login manager." >&2
        exit 1
    fi
    echo "==> Booting $USER_NAME straight into xLab TV"
    sudo sed -i -e '/^AutomaticLoginEnable/d' -e '/^AutomaticLogin=/d' \
        -e "s/^\[daemon\]/[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=$USER_NAME/" /etc/gdm3/custom.conf
    ACCT=/var/lib/AccountsService/users/$USER_NAME
    if sudo test -f "$ACCT"; then
        sudo sed -i -e '/^Session=/d' -e '/^XSession=/d' -e "s/^\[User\]/[User]\nSession=xlab-tv/" "$ACCT"
    else
        printf '[User]\nSession=xlab-tv\n' | sudo tee "$ACCT" >/dev/null
    fi
fi

echo "==> Done. Log out and pick \"xLab TV\" at the login screen (gear icon)."
