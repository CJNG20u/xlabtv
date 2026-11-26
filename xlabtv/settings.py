"""Quick settings for the TV: Wi-Fi (nmcli), Bluetooth (bluetoothctl), sound (pactl),
update checks, and shortcuts into Ubuntu's own Settings pages.

Every command goes through `run`, so tests can replace it. Errors come back as
SettingsError with a short message the TV can show.
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from pathlib import Path

MAC = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$", re.I)
SETTINGS_PAGES = {"display", "sound", "wifi", "network", "bluetooth", "power", "displays"}


class SettingsError(RuntimeError):
    pass


def default_run(cmd, timeout=15):
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise SettingsError(f"{cmd[0]} is not installed")
    except subprocess.TimeoutExpired:
        raise SettingsError(f"{cmd[0]} took too long")
    return res.returncode, res.stdout, res.stderr


def _check(result, what):
    code, out, err = result
    if code != 0:
        line = next((l.strip() for l in (err or out).splitlines()[::-1] if l.strip()), "")
        raise SettingsError(f"{what}: {line}" if line else what)
    return out


def split_terse(line: str) -> list[str]:
    """nmcli -t fields: ':' separates, '\\:' is a literal colon."""
    fields, cur, i = [], "", 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            cur += line[i + 1]
            i += 2
            continue
        if c == ":":
            fields.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    fields.append(cur)
    return fields


# ---------------------------------------------------------------- Wi-Fi

def wifi_status(run=default_run, rescan=False) -> dict:
    radio = _check(run(["nmcli", "radio", "wifi"]), "Wi-Fi").strip() == "enabled"
    devices = _check(run(["nmcli", "-t", "-f", "TYPE,STATE,CONNECTION", "device"]), "network devices")
    ethernet = any(split_terse(l)[:2] == ["ethernet", "connected"] for l in devices.splitlines())
    networks, connected = {}, None
    if radio:
        out = _check(run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
                          "--rescan", "yes" if rescan else "auto"], 30), "Wi-Fi networks")
        for line in out.splitlines():
            f = split_terse(line)
            if len(f) < 4 or not f[1]:
                continue
            ssid, in_use = f[1], f[0] == "*"
            signal = int(f[2]) if f[2].isdigit() else 0
            net = {"ssid": ssid, "signal": signal, "secure": f[3] not in ("", "--"), "connected": in_use}
            if ssid not in networks or networks[ssid]["signal"] < signal or in_use:
                networks[ssid] = {**net, "connected": in_use or networks.get(ssid, {}).get("connected", False)}
            if in_use:
                connected = {"ssid": ssid, "signal": signal}
    ordered = sorted(networks.values(), key=lambda n: (not n["connected"], -n["signal"]))
    return {"enabled": radio, "ethernet": ethernet, "connected": connected, "networks": ordered}


def wifi_action(body: dict, run=default_run) -> dict:
    action = body.get("action")
    if action == "rescan":
        return wifi_status(run, rescan=True)
    if action == "power":
        _check(run(["nmcli", "radio", "wifi", "on" if body.get("on") else "off"]), "Wi-Fi")
        return wifi_status(run)
    if action == "connect":
        ssid = str(body.get("ssid", ""))
        if not ssid or len(ssid) > 64:
            raise SettingsError("pick a network")
        cmd = ["nmcli", "device", "wifi", "connect", ssid]
        if body.get("password"):
            cmd += ["password", str(body["password"])]
        _check(run(cmd, 45), f"Could not join {ssid}")
        return wifi_status(run)
    if action == "disconnect":
        out = _check(run(["nmcli", "-t", "-f", "TYPE,DEVICE", "device"]), "network devices")
        for line in out.splitlines():
            f = split_terse(line)
            if f[0] == "wifi":
                _check(run(["nmcli", "device", "disconnect", f[1]]), "Disconnect")
        return wifi_status(run)
    raise SettingsError("unknown Wi-Fi action")


# ---------------------------------------------------------------- Bluetooth

def _bt_devices(out: str) -> dict[str, str]:
    devs = {}
    for line in out.splitlines():
        parts = line.split(" ", 2)
        if len(parts) >= 2 and parts[0] == "Device" and MAC.match(parts[1]):
            devs[parts[1].upper()] = parts[2] if len(parts) > 2 else parts[1]
    return devs


def bluetooth_status(run=default_run) -> dict:
    show = run(["bluetoothctl", "show"], 10)
    if show[0] != 0 or "Controller" not in show[1]:
        return {"available": False, "powered": False, "devices": []}
    powered = re.search(r"Powered:\s*yes", show[1]) is not None
    known = _bt_devices(_check(run(["bluetoothctl", "devices"], 10), "Bluetooth"))
    paired = _bt_devices(run(["bluetoothctl", "devices", "Paired"], 10)[1])
    conn = _bt_devices(run(["bluetoothctl", "devices", "Connected"], 10)[1])
    devices = [{"mac": mac, "name": name, "paired": mac in paired, "connected": mac in conn}
               for mac, name in known.items()]
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"].lower()))
    return {"available": True, "powered": powered, "devices": devices}


def bluetooth_action(body: dict, run=default_run) -> dict:
    action = body.get("action")
    if action == "power":
        _check(run(["bluetoothctl", "power", "on" if body.get("on") else "off"], 10), "Bluetooth")
    elif action == "scan":
        # discover for a few seconds; new devices then show in the list
        run(["bluetoothctl", "--timeout", "8", "scan", "on"], 15)
    elif action in ("pair", "connect", "disconnect", "remove"):
        mac = str(body.get("mac", "")).upper()
        if not MAC.match(mac):
            raise SettingsError("pick a device")
        if action == "pair":
            _check(run(["bluetoothctl", "pair", mac], 30), "Pairing failed")
            run(["bluetoothctl", "trust", mac], 10)
            _check(run(["bluetoothctl", "connect", mac], 20), "Paired, but could not connect")
        else:
            _check(run(["bluetoothctl", action, mac], 20), f"Could not {action}")
    else:
        raise SettingsError("unknown Bluetooth action")
    return bluetooth_status(run)


# ---------------------------------------------------------------- Sound

def _percent(volume: dict) -> int:
    for ch in volume.values():
        if isinstance(ch, dict) and str(ch.get("value_percent", "")).rstrip("%").isdigit():
            return int(str(ch["value_percent"]).rstrip("%"))
    return 0


def audio_status(run=default_run) -> dict:
    sinks = json.loads(_check(run(["pactl", "-f", "json", "list", "sinks"]), "Sound") or "[]")
    default = _check(run(["pactl", "get-default-sink"]), "Sound").strip()
    outputs, volume, muted = [], 0, False
    for s in sinks:
        is_default = s.get("name") == default
        outputs.append({"id": s.get("name", ""), "name": s.get("description") or s.get("name", ""),
                        "default": is_default})
        if is_default:
            volume, muted = _percent(s.get("volume", {})), bool(s.get("mute"))
    return {"outputs": outputs, "volume": volume, "muted": muted}


def audio_action(body: dict, run=default_run) -> dict:
    action = body.get("action")
    sink = "@DEFAULT_SINK@"
    if action == "output":
        names = {o["id"] for o in audio_status(run)["outputs"]}
        if body.get("id") not in names:
            raise SettingsError("pick a sound output")
        _check(run(["pactl", "set-default-sink", body["id"]]), "Sound output")
    elif action == "volume":
        level = max(0, min(100, int(body.get("level", 0))))
        _check(run(["pactl", "set-sink-volume", sink, f"{level}%"]), "Volume")
    elif action in ("up", "down"):
        current = audio_status(run)["volume"]
        level = max(0, min(100, current + (5 if action == "up" else -5)))
        _check(run(["pactl", "set-sink-volume", sink, f"{level}%"]), "Volume")
    elif action == "mute":
        _check(run(["pactl", "set-sink-mute", sink, "toggle"]), "Mute")
    else:
        raise SettingsError("unknown sound action")
    return audio_status(run)


# ---------------------------------------------------------------- Ubuntu Settings pages

def open_settings_page(page: str, popen=subprocess.Popen) -> None:
    if page not in SETTINGS_PAGES:
        raise SettingsError("unknown settings page")
    page = {"display": "display", "displays": "display", "network": "network"}.get(page, page)
    try:
        popen(["gnome-control-center", page], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
              stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:
        raise SettingsError(f"could not open Settings: {exc.strerror or exc}")


# ---------------------------------------------------------------- Updates

class UpdateChecker:
    """Counts what Updates would install, checked in the background (soon after start,
    then every 6 hours). Nothing is installed here: that's the Updates tile's job."""

    LATEST_VERSION = "https://github.com/CJNG20u/xlabtv/releases/download/latest/VERSION"

    def __init__(self, source_dir_file: Path = Path("/usr/lib/xlab-tv/source-dir"), run=default_run,
                 first_after: float = 120, every: float = 6 * 3600, start=True,
                 version_file: Path = Path("/usr/lib/xlab-tv/version"), fetch=None):
        self.source_dir_file, self.run = source_dir_file, run
        self.version_file = version_file
        self.fetch = fetch or _fetch_text
        self.state = {"xlabtv": False, "apps": 0, "system": 0, "total": 0, "checked": None}
        self._lock = threading.Lock()
        if start:
            threading.Thread(target=self._loop, args=(first_after, every), daemon=True).start()

    def get(self) -> dict:
        with self._lock:
            return dict(self.state)

    def _loop(self, first_after, every):
        time.sleep(first_after)
        while True:
            try:
                self.check()
            except Exception:
                pass
            time.sleep(every)

    def check(self) -> dict:
        xlabtv = False
        try:
            repo = self.source_dir_file.read_text().strip()
            if repo and Path(repo, ".git").exists():
                # a git checkout: commits waiting upstream
                if self.run(["git", "-C", repo, "fetch", "-q"], 60)[0] == 0:
                    code, out, _ = self.run(["git", "-C", repo, "rev-list", "--count", "HEAD..@{u}"], 10)
                    xlabtv = code == 0 and out.strip().isdigit() and int(out.strip()) > 0
            else:
                # a ready-made package: a newer one published
                latest = self.fetch(self.LATEST_VERSION).strip()
                xlabtv = bool(latest) and latest != self.version_file.read_text().strip()
        except (OSError, SettingsError, ValueError):
            pass
        apps = 0
        try:
            code, out, _ = self.run(["flatpak", "remote-ls", "--updates", "--user", "--columns=application"], 120)
            apps = len([l for l in out.splitlines() if l.strip()]) if code == 0 else 0
        except SettingsError:
            pass
        system = 0
        try:
            code, out, err = self.run(["/usr/lib/update-notifier/apt-check"], 60)
            m = re.match(r"(\d+);(\d+)", (err or out).strip())
            system = int(m.group(1)) if m else 0
        except SettingsError:
            pass
        state = {"xlabtv": xlabtv, "apps": apps, "system": system,
                 "total": apps + system + (1 if xlabtv else 0), "checked": int(time.time())}
        with self._lock:
            self.state = state
        return state


def _fetch_text(url: str) -> str:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "xlab-tv"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read(200).decode("utf-8", "replace")
