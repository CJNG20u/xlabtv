#!/bin/sh
# Removes xLab TV and undoes what install.sh set up. Run as your normal user:
#   wget -qO- https://github.com/CJNG20u/xlabtv/releases/download/latest/uninstall.sh | sh
#   ... | sh -s -- --keep-config     keep your app list, YouTube channels and paired phones
# Apps you installed from the Store (Flatpaks) are yours and stay; see the end for how to remove them.
set -u

KEEP_CONFIG=0
[ "${1:-}" = "--keep-config" ] && KEEP_CONFIG=1
USER_NAME=$(id -un)
CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}
DATA=${XDG_DATA_HOME:-$HOME/.local/share}

if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as your normal user; it asks for sudo when needed." >&2
    exit 1
fi

echo "==> Stopping xLab TV"
pkill -u "$(id -u)" -f 'xlab-tv-kiosk' 2>/dev/null
pkill -u "$(id -u)" -f '^python3 [^ ]*/xlabtv/(server|window)\.py' 2>/dev/null
pkill -u "$(id -u)" -f -- '--profile [^ ]*(xlab-tv-profile|xlab-tv/firefox-profile)' 2>/dev/null

echo "==> Removing the launcher, its menu entry and commands"
rm -f "$CONFIG/autostart/xlab-tv.desktop"
sudo rm -rf /usr/lib/xlab-tv
sudo rm -f /usr/local/bin/xlab-tv-apps /usr/local/bin/xlab-tv-update
sudo rm -f /usr/share/applications/tv.xlab.Launcher.desktop
sudo rm -f /usr/share/icons/hicolor/scalable/apps/tv.xlab.Launcher.svg
sudo gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
sudo rm -f /usr/share/wayland-sessions/xlab-tv.desktop   # from the first versions

echo "==> Removing the GNOME extension"
gnome-extensions disable xlab-tv@xlab.tv 2>/dev/null || true
rm -rf "$DATA/gnome-shell/extensions/xlab-tv@xlab.tv"
python3 - <<'PYEOF'
import ast, subprocess
def get(key):
    out = subprocess.run(["gsettings", "get", "org.gnome.shell", key], capture_output=True, text=True).stdout
    out = out.strip().replace("@as ", "")
    return ast.literal_eval(out) if out else []
enabled = get("enabled-extensions")
if "xlab-tv@xlab.tv" in enabled:
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions",
                    str([e for e in enabled if e != "xlab-tv@xlab.tv"])])
PYEOF

echo "==> Removing the remote button mapping and the phone remote's keyboard permission"
if [ -f /etc/keyd/xlab-tv.conf ]; then
    sudo rm -f /etc/keyd/xlab-tv.conf
    if ls /etc/keyd/*.conf >/dev/null 2>&1; then
        sudo systemctl restart keyd 2>/dev/null || true
    else
        sudo systemctl disable --now keyd 2>/dev/null || true   # nothing else uses it
    fi
fi
sudo rm -f /etc/udev/rules.d/60-xlab-tv-uinput.rules /etc/modules-load.d/xlab-tv-uinput.conf
sudo udevadm control --reload-rules 2>/dev/null || true
if command -v ufw >/dev/null 2>&1; then
    sudo ufw delete allow 8766/tcp >/dev/null 2>&1 || true
fi

echo "==> Back to the normal login screen, screen lock and power settings"
if [ -f /etc/gdm3/custom.conf ] && grep -q "^AutomaticLogin=$USER_NAME$" /etc/gdm3/custom.conf; then
    sudo sed -i -e '/^AutomaticLoginEnable/d' -e '/^AutomaticLogin=/d' /etc/gdm3/custom.conf
    echo "    automatic login is off"
fi
gsettings reset org.gnome.desktop.session idle-delay
gsettings reset org.gnome.desktop.screensaver lock-enabled
gsettings reset org.gnome.desktop.notifications show-banners
gsettings reset org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type

echo "==> Removing xLab TV's files"
rm -rf "$DATA/xlab-tv-source" "$DATA/xlab-tv-source.old"
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/xlab-tv" "${XDG_CACHE_HOME:-$HOME/.cache}/xlab-tv"
rm -rf "$HOME/snap/firefox/common/xlab-tv-profile"
if [ "$KEEP_CONFIG" -eq 1 ]; then
    echo "    kept your settings in $CONFIG/xlab-tv"
else
    rm -rf "$CONFIG/xlab-tv"
fi

cat <<'EOF'

==> xLab TV is removed. Log out and back in (or restart) to finish.

Left in place, as they are yours or harmless:
  - Apps you installed from the Store. See them with:  flatpak list --user --app
    Remove one with:                                   flatpak uninstall --user <app id>
  - Packages the installer added (keyd, python3-evdev, flatpak, ...).
  - Wake-on-LAN on your network connection.
  - A git checkout of xlabtv, if you made one: delete that folder yourself.
EOF
