#!/usr/bin/env python3
"""The built-in catalog of TV apps: which are installed, how to start them, their icons.

Also a small command-line helper:
    apps.py list                 every catalog app and whether it is installed
    apps.py install youtube ...  install apps (Flatpaks, no password needed)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG_PATH = HERE / "catalog.json"


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def installed_flatpaks(run=subprocess.run) -> set[str]:
    """App IDs of installed Flatpaks (user and system); empty if Flatpak is missing."""
    try:
        out = run(["flatpak", "list", "--app", "--columns=application"],
                  capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


def _icon_dirs(home: Path) -> list[Path]:
    return [
        home / ".local/share/flatpak/exports/share/icons/hicolor",
        Path("/var/lib/flatpak/exports/share/icons/hicolor"),
        home / ".local/share/icons/hicolor",
        Path("/usr/share/icons/hicolor"),
    ]


def find_icon(name: str, home: Path | None = None) -> Path | None:
    """The biggest installed icon for an icon name, scalable first."""
    home = home or Path.home()
    sizes = ["scalable", "512x512", "256x256", "192x192", "128x128", "96x96", "64x64", "48x48"]
    for base in _icon_dirs(home):
        for size in sizes:
            for ext in ("svg", "png"):
                path = base / size / "apps" / f"{name}.{ext}"
                if path.is_file():
                    return path
    for ext in ("svg", "png"):
        path = Path("/usr/share/pixmaps") / f"{name}.{ext}"
        if path.is_file():
            return path
    return None


def _command(entry: dict, flatpaks: set[str], which) -> list[str] | None:
    args = list(entry.get("args", []))
    if entry.get("binary") and which(entry["binary"]):
        return [entry["binary"], *args]
    if entry.get("flatpak") in flatpaks:
        return ["flatpak", "run", entry["flatpak"], *args]
    return None


def detect(catalog: dict, flatpaks: set[str] | None = None, which=shutil.which,
           home: Path | None = None) -> dict:
    """Installed catalog apps, in catalog order, in the server's app shape."""
    if flatpaks is None:
        flatpaks = installed_flatpaks()
    browser = catalog.get("browser", {})
    apps = {}
    for app_id, entry in catalog["apps"].items():
        if entry.get("terminal"):
            term = next((t for t in catalog.get("terminals", []) if which(t["binary"])), None)
            if term is None:
                continue
            extra = entry["terminal"]
            command = list(term["open"]) if extra is True else [*term["run"], *extra]
            icon = find_icon("utilities-terminal", home) or find_icon("org.gnome.Ptyxis", home)
        elif entry.get("web"):
            base = _command({k: v for k, v in browser.items() if k != "args"}, flatpaks, which)
            if base is None:
                continue
            args = [a.replace("{url}", entry["web"]) for a in browser.get("args", [])]
            command = [*base, *args]
            icon = None
        else:
            command = _command(entry, flatpaks, which)
            if command is None:
                continue
            icon = find_icon(entry.get("icon") or entry.get("flatpak") or entry.get("binary", ""), home)
        apps[app_id] = {
            "name": entry["name"],
            "subtitle": entry.get("subtitle", ""),
            "color": entry.get("color", "#3b82f6"),
            "row": entry.get("row", "Apps"),
            "command": command,
            "media": {"icon": icon} if icon else {},
        }
        if entry.get("buttons"):
            apps[app_id]["buttons"] = entry["buttons"]  # app shortcuts for the phone remote
    return apps


# ---------------------------------------------------------------- store

FLATHUB_APPSTREAM = "https://flathub.org/api/v2/appstream/{}"


def install_target(catalog: dict, app_id: str) -> tuple[str, str]:
    """(remote, flatpak id) that installs a catalog app; web apps install the browser."""
    entry = catalog["apps"][app_id]
    if entry.get("web"):
        return "flathub", catalog["browser"]["flatpak"]
    return entry.get("remote", "flathub"), entry["flatpak"]


def install_commands(catalog: dict, app_id: str) -> list[list[str]]:
    remote, flatpak_id = install_target(catalog, app_id)
    remotes = catalog.get("remotes", {})
    cmds = [["flatpak", "remote-add", "--user", "--if-not-exists", "flathub", remotes["flathub"]]]
    if remote != "flathub":
        cmds.append(["flatpak", "remote-add", "--user", "--if-not-exists", remote, remotes[remote]])
    cmds.append(["flatpak", "install", "--user", "-y", "--noninteractive", remote, flatpak_id])
    return cmds


def user_flatpaks(run=subprocess.run) -> set[str]:
    try:
        out = run(["flatpak", "list", "--user", "--app", "--columns=application"],
                  capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


class Store:
    """Installs and removes catalog apps one at a time, in the background, without sudo."""

    def __init__(self, catalog: dict, cache_dir: Path, on_change=None, run=subprocess.run, fetch=None):
        self.catalog = catalog
        self.cache_dir = cache_dir
        self.on_change = on_change or (lambda: None)
        self.run = run
        self.fetch = fetch or _fetch_url
        self.jobs: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._queue: list[tuple[str, str]] = []
        self._wake = threading.Event()
        self._icons_started = False
        threading.Thread(target=self._worker, daemon=True).start()

    # -- listing -----------------------------------------------------------
    def items(self, installed: dict) -> list[dict]:
        self._start_icon_fetch()
        out = []
        for app_id, entry in self.catalog["apps"].items():
            if entry.get("terminal"):
                continue  # built-in tools, nothing to install
            icon = (installed.get(app_id, {}).get("media", {}).get("icon") or self.icon_path(app_id))
            out.append({
                "id": app_id,
                "name": entry["name"],
                "subtitle": entry.get("subtitle", ""),
                "description": entry.get("description", ""),
                "category": entry.get("row", "Apps"),
                "color": entry.get("color", "#3b82f6"),
                "icon": f"/media/{app_id}/icon" if icon else "",
                "installed": app_id in installed,
                "job": self.jobs.get(app_id),
            })
        return out

    # -- jobs --------------------------------------------------------------
    def request(self, app_id: str, action: str) -> None:
        if app_id not in self.catalog["apps"]:
            raise KeyError(app_id)
        if action not in ("install", "remove"):
            raise ValueError(action)
        with self._lock:
            job = self.jobs.get(app_id)
            if job and job["state"] in ("queued", "running"):
                raise RuntimeError(f"{self.catalog['apps'][app_id]['name']} is already being changed")
            self.jobs[app_id] = {"action": action, "state": "queued", "message": ""}
            self._queue.append((app_id, action))
        self._wake.set()

    def _worker(self):
        while True:
            self._wake.wait()
            with self._lock:
                if not self._queue:
                    self._wake.clear()
                    continue
                app_id, action = self._queue.pop(0)
                self.jobs[app_id]["state"] = "running"
            try:
                message = self._do(app_id, action)
                state = "done"
            except RuntimeError as exc:
                message, state = str(exc), "failed"
            with self._lock:
                self.jobs[app_id].update(state=state, message=message)
            self.on_change()

    def _do(self, app_id: str, action: str) -> str:
        name = self.catalog["apps"][app_id]["name"]
        if action == "install":
            cmds = install_commands(self.catalog, app_id)
        else:
            _, flatpak_id = install_target(self.catalog, app_id)
            if flatpak_id not in user_flatpaks(self.run):
                raise RuntimeError(f"{name} was installed outside xLab TV; remove it from the desktop")
            cmds = [["flatpak", "uninstall", "--user", "-y", "--noninteractive", flatpak_id]]
        for cmd in cmds:
            try:
                res = self.run(cmd, capture_output=True, text=True, timeout=3600)
            except FileNotFoundError:
                raise RuntimeError("Flatpak is not installed (run install.sh again)")
            except (OSError, subprocess.SubprocessError) as exc:
                raise RuntimeError(f"{name}: {exc}")
            if res.returncode != 0:
                lines = [l for l in (res.stderr or res.stdout or "").splitlines() if l.strip()]
                raise RuntimeError(lines[-1].strip() if lines else f"{name}: {action} failed")
        return f"{name} {'installed' if action == 'install' else 'removed'}"

    # -- icons for apps that are not installed yet -------------------------
    def icon_path(self, app_id: str) -> Path | None:
        path = self.cache_dir / f"{app_id}.png"
        return path if path.is_file() and path.stat().st_size > 0 else None

    def _start_icon_fetch(self):
        if self._icons_started:
            return
        self._icons_started = True
        threading.Thread(target=self._fetch_icons, daemon=True).start()

    def _fetch_icons(self):
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        for app_id, entry in self.catalog["apps"].items():
            if (entry.get("web") or entry.get("terminal") or entry.get("remote", "flathub") != "flathub"
                    or self.icon_path(app_id)):
                continue
            try:
                meta = json.loads(self.fetch(FLATHUB_APPSTREAM.format(entry["flatpak"])))
                url = meta.get("icon") or ""
                if url.startswith("https://"):
                    (self.cache_dir / f"{app_id}.png").write_bytes(self.fetch(url))
            except Exception:  # offline or not on Flathub: the card uses its colour
                continue


def _fetch_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "xlab-tv"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read(2_000_000)


# ---------------------------------------------------------------- command line

def cmd_list(catalog: dict) -> int:
    installed = detect(catalog)
    for app_id, entry in catalog["apps"].items():
        if entry.get("terminal"):
            continue
        mark = "installed" if app_id in installed else "-"
        print(f"  {app_id:<10} {entry['name']:<12} {mark}")
    return 0


def cmd_install(catalog: dict, names: list[str]) -> int:
    unknown = [n for n in names if n not in catalog["apps"] or catalog["apps"][n].get("terminal")]
    if unknown:
        print(f"Unknown app(s): {', '.join(unknown)}. Run 'list' to see the names.", file=sys.stderr)
        return 2
    if not shutil.which("flatpak"):
        print("Flatpak is missing: sudo apt install flatpak", file=sys.stderr)
        return 1
    for name in names:
        print(f"==> Installing {catalog['apps'][name]['name']}")
        for cmd in install_commands(catalog, name):
            subprocess.run(cmd, check=True)
    print("==> Done. Log out and back in (or restart xLab TV) to see them.")
    return 0


def main(argv: list[str]) -> int:
    catalog = load_catalog()
    if len(argv) >= 2 and argv[1] == "list":
        return cmd_list(catalog)
    if len(argv) >= 3 and argv[1] == "install":
        return cmd_install(catalog, argv[2:])
    print(__doc__.strip().split("\n\n", 1)[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
