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
sudo apt-get install -y python3 python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 flatpak python3-evdev \
    network-manager bluez pulseaudio-utils

echo "==> Copying xLab TV to $PREFIX"
sudo mkdir -p "$PREFIX/xlabtv" "$PREFIX/session" "$PREFIX/ui"
# every backend file (so a new module can't be forgotten here)
sudo install -m 0644 xlabtv/*.py xlabtv/*.json xlabtv/*.html "$PREFIX/xlabtv/"
# "xlab-tv-apps list" / "xlab-tv-apps install youtube spotify"
printf '#!/bin/sh\nexec python3 %s/xlabtv/apps.py "$@"\n' "$PREFIX" | sudo tee /usr/local/bin/xlab-tv-apps >/dev/null
sudo chmod 0755 /usr/local/bin/xlab-tv-apps
sudo install -m 0755 session/xlab-tv-kiosk "$PREFIX/session/"
sudo install -m 0644 session/user.js "$PREFIX/session/"
# name and icon for the window in the app switcher
sudo install -Dm 0644 session/tv.xlab.Launcher.desktop /usr/share/applications/tv.xlab.Launcher.desktop
sudo install -Dm 0644 session/tv.xlab.Launcher.svg /usr/share/icons/hicolor/scalable/apps/tv.xlab.Launcher.svg
sudo gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
# Build the UI every time, so a git pull brings the latest screens.
if command -v npm >/dev/null 2>&1; then
    echo "==> Building the UI"
    npm install --no-audit --no-fund --legacy-peer-deps && npm run build
elif [ ! -f dist/index.html ]; then
    echo "    (no npm: install nodejs + npm and re-run to build the UI; using the built-in page for now)"
fi
if [ -f dist/index.html ]; then
    sudo rm -rf "$PREFIX/ui/dist"
    sudo cp -r dist "$PREFIX/ui/dist"
fi

# Phone remote: let the logged-in user create the virtual keyboard and mouse
# (the same rule Steam uses for its controller support), and load uinput at boot.
echo "==> Allowing the phone remote's virtual keyboard"
echo 'KERNEL=="uinput", SUBSYSTEM=="misc", OPTIONS+="static_node=uinput", TAG+="uaccess"' |
    sudo tee /etc/udev/rules.d/60-xlab-tv-uinput.rules >/dev/null
echo uinput | sudo tee /etc/modules-load.d/xlab-tv-uinput.conf >/dev/null
sudo modprobe uinput
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=uinput
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
    sudo ufw allow 8766/tcp comment "xLab TV phone remote" >/dev/null
fi

# Where this checkout is, for the update check behind the gear's badge.
pwd | sudo tee "$PREFIX/source-dir" >/dev/null

# The "Updates" tile runs this; it knows where this checkout is.
sed "s|@REPO@|$(pwd)|" session/xlab-tv-update | sudo tee /usr/local/bin/xlab-tv-update >/dev/null
sudo chmod 0755 /usr/local/bin/xlab-tv-update

# Wake-on-LAN: let the network card wake the PC with a "magic packet" (Ethernet
# from sleep or off, if the BIOS allows it; Wi-Fi from sleep only, if the card can).
if command -v nmcli >/dev/null 2>&1; then
    echo "==> Turning on Wake-on-LAN for your network connections"
    nmcli -t -f NAME,TYPE connection show | while IFS=: read -r name type; do
        case "$type" in
            802-3-ethernet) sudo nmcli connection modify "$name" 802-3-ethernet.wake-on-lan magic || true ;;
            802-11-wireless) sudo nmcli connection modify "$name" 802-11-wireless.wake-on-wlan magic 2>/dev/null || true ;;
        esac
    done
fi

# Remote buttons: Back -> Esc, Home -> F20 (keyd), and the GNOME extension that makes
# F20 (and the phone remote's Home) bring xLab TV forward without closing the app.
echo "==> Remote buttons (keyd) and the xLab TV GNOME extension"
sudo apt-get install -y keyd >/dev/null
if ls /etc/keyd/*.conf 2>/dev/null | grep -qv '/xlab-tv.conf$'; then
    echo "    keyd already has your own config; add these lines to it yourself:"
    sed -n '/^\[main\]/,$p' session/keyd-xlab-tv.conf | sed 's/^/      /'
else
    sudo install -Dm 0644 session/keyd-xlab-tv.conf /etc/keyd/xlab-tv.conf
fi
sudo systemctl enable keyd >/dev/null 2>&1 || true
sudo systemctl restart keyd || true

EXT_UUID=xlab-tv@xlab.tv
EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$EXT_UUID
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r "gnome-extension/$EXT_UUID/." "$EXT_DIR/"
glib-compile-schemas "$EXT_DIR/schemas"
# GNOME loads a new extension at the next login; turn it on for then (and now, if it can).
python3 - "$EXT_UUID" <<'PYEOF'
import ast, subprocess, sys
uuid = sys.argv[1]
def get(key):
    out = subprocess.run(["gsettings", "get", "org.gnome.shell", key], capture_output=True, text=True).stdout
    out = out.strip().replace("@as ", "")
    return ast.literal_eval(out) if out else []
enabled = get("enabled-extensions")
if uuid not in enabled:
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(enabled + [uuid])])
disabled = get("disabled-extensions")
if uuid in disabled:
    subprocess.run(["gsettings", "set", "org.gnome.shell", "disabled-extensions",
                    str([d for d in disabled if d != uuid])])
PYEOF
gsettings set org.gnome.shell disable-user-extensions false
gnome-extensions enable "$EXT_UUID" 2>/dev/null || true

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
