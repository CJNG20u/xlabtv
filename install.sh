#!/bin/sh
# Installs xLab TV on Ubuntu. Run from the repo folder as your normal user:
#   sh install.sh                the launcher opens full screen when you log in
#   sh install.sh --autologin    also log in automatically and keep the screen on
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
sudo apt-get install -y python3 python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 flatpak

echo "==> Copying xLab TV to $PREFIX"
sudo mkdir -p "$PREFIX/xlabtv" "$PREFIX/session" "$PREFIX/ui"
sudo install -m 0644 xlabtv/server.py xlabtv/apps.py xlabtv/catalog.json xlabtv/window.py \
    xlabtv/fallback.html "$PREFIX/xlabtv/"
# "xlab-tv-apps list" / "xlab-tv-apps install youtube spotify"
printf '#!/bin/sh\nexec python3 %s/xlabtv/apps.py "$@"\n' "$PREFIX" | sudo tee /usr/local/bin/xlab-tv-apps >/dev/null
sudo chmod 0755 /usr/local/bin/xlab-tv-apps
sudo install -m 0755 session/xlab-tv-kiosk "$PREFIX/session/"
sudo install -m 0644 session/user.js "$PREFIX/session/"
# name and icon for the window in the app switcher
sudo install -Dm 0644 session/tv.xlab.Launcher.desktop /usr/share/applications/tv.xlab.Launcher.desktop
sudo install -Dm 0644 session/tv.xlab.Launcher.svg /usr/share/icons/hicolor/scalable/apps/tv.xlab.Launcher.svg
sudo gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
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

# Earlier versions added a cage login session, which crashes with Firefox: remove it.
sudo rm -f /usr/share/wayland-sessions/xlab-tv.desktop
ACCT=/var/lib/AccountsService/users/$USER_NAME
if sudo grep -q '^Session=xlab-tv' "$ACCT" 2>/dev/null; then
    sudo sed -i '/^Session=xlab-tv/d' "$ACCT"
fi

CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}/xlab-tv/apps.json
# The first version's example listed fixed rows, which would hide catalog apps: replace it.
if [ -f "$CONFIG" ] && grep -q '"title": "Your apps"' "$CONFIG" && grep -q 'rocks.shy.VacuumTube' "$CONFIG"; then
    mv "$CONFIG" "$CONFIG.old"
    echo "==> Moved the old example app list to $CONFIG.old (apps are now found automatically)"
fi
if [ ! -f "$CONFIG" ]; then
    mkdir -p "$(dirname "$CONFIG")"
    cp apps.example.json "$CONFIG"
    echo "==> Wrote your app list to $CONFIG (edit it to add apps)"
fi
python3 "$PREFIX/xlabtv/server.py" --config "$CONFIG" --check
echo "    Add more with: xlab-tv-apps list   then   xlab-tv-apps install youtube spotify ..."

echo "==> Starting the launcher at login"
AUTOSTART=${XDG_CONFIG_HOME:-$HOME/.config}/autostart
mkdir -p "$AUTOSTART"
printf '%s\n' \
    '[Desktop Entry]' \
    'Type=Application' \
    'Name=xLab TV' \
    'Comment=TV home screen' \
    "Exec=$PREFIX/session/xlab-tv-kiosk" \
    'X-GNOME-Autostart-enabled=true' >"$AUTOSTART/xlab-tv.desktop"

if [ "$AUTOLOGIN" -eq 1 ]; then
    if [ ! -f /etc/gdm3/custom.conf ]; then
        echo "Auto-login setup supports GDM only; set it up in your login manager." >&2
        exit 1
    fi
    echo "==> Logging $USER_NAME in automatically, screen always on"
    sudo sed -i -e '/^AutomaticLoginEnable/d' -e '/^AutomaticLogin=/d' \
        -e "s/^\[daemon\]/[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=$USER_NAME/" /etc/gdm3/custom.conf
    gsettings set org.gnome.desktop.session idle-delay 0
    gsettings set org.gnome.desktop.screensaver lock-enabled false
    gsettings set org.gnome.desktop.notifications show-banners false
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
fi

echo "==> Done. Log out and back in, or start it now with: $PREFIX/session/xlab-tv-kiosk &"
