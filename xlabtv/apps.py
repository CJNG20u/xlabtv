#!/usr/bin/env python3
"""The built-in catalog of TV apps: which are installed, how to start them, their icons.

Also a small command-line helper:
    apps.py list                 every catalog app and whether it is installed
    apps.py install youtube ...  install apps (Flatpaks from Flathub, Nuvio's .deb)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG_PATH = HERE / "catalog.json"
NUVIO_RELEASES = "https://api.github.com/repos/iamSlokker/NuvioDesktop-Linux/releases/latest"


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
        if entry.get("web"):
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
    return apps


# ---------------------------------------------------------------- command line

def _flathub_ready() -> None:
    if not shutil.which("flatpak"):
        print("==> Installing Flatpak")
        subprocess.run(["sudo", "apt-get", "install", "-y", "flatpak"], check=True)
    subprocess.run(["flatpak", "remote-add", "--user", "--if-not-exists", "flathub",
                    "https://dl.flathub.org/repo/flathub.flatpakrepo"], check=True)


def _install_nuvio_deb() -> None:
    print("==> Downloading the latest Nuvio .deb from iamSlokker/NuvioDesktop-Linux")
    with urllib.request.urlopen(NUVIO_RELEASES, timeout=30) as resp:
        release = json.load(resp)
    debs = [a for a in release.get("assets", []) if a["name"].endswith("x86_64.deb")]
    if not debs:
        raise SystemExit("No x86_64 .deb in Nuvio's latest release; install it by hand.")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / debs[0]["name"]
        urllib.request.urlretrieve(debs[0]["browser_download_url"], path)
        os.chmod(tmp, 0o755)  # apt's sandbox user must be able to read it
        os.chmod(path, 0o644)
        subprocess.run(["sudo", "apt-get", "install", "-y", str(path)], check=True)


def cmd_list(catalog: dict) -> int:
    installed = detect(catalog)
    for app_id, entry in catalog["apps"].items():
        mark = "installed" if app_id in installed else "-"
        print(f"  {app_id:<10} {entry['name']:<12} {mark}")
    return 0


def cmd_install(catalog: dict, names: list[str]) -> int:
    unknown = [n for n in names if n not in catalog["apps"]]
    if unknown:
        print(f"Unknown app(s): {', '.join(unknown)}. Run 'list' to see the names.", file=sys.stderr)
        return 2
    flatpak_ids = []
    for name in names:
        entry = catalog["apps"][name]
        if entry.get("install") == "nuvio-deb":
            _install_nuvio_deb()
        elif entry.get("web"):
            flatpak_ids.append(catalog["browser"]["flatpak"])
        else:
            flatpak_ids.append(entry["flatpak"])
    if flatpak_ids:
        _flathub_ready()
        ids = list(dict.fromkeys(flatpak_ids))
        print(f"==> Installing from Flathub: {' '.join(ids)}")
        subprocess.run(["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", *ids], check=True)
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
