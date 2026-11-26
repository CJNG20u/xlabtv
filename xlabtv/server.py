#!/usr/bin/env python3
"""xLab TV local service.

Serves the launcher UI and a small JSON API that lists the configured apps,
launches them and handles power actions. It listens on 127.0.0.1 only, checks
the Host header (against DNS rebinding) and requires a per-run token that is
injected into the UI page, so other web pages cannot drive it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import apps as apps_catalog  # noqa: E402  (xlabtv/apps.py, beside this file)
import nuvio  # noqa: E402
import youtube  # noqa: E402
import settings as settings_mod  # noqa: E402
import remote as remote_mod  # noqa: E402

MAX_BODY = 4096
mimetypes.add_type("application/manifest+json", ".webmanifest")
POWER_COMMANDS = {
    "suspend": ["systemctl", "suspend"],
    "reboot": ["systemctl", "reboot"],
    "poweroff": ["systemctl", "poweroff"],
}
HERE = Path(__file__).resolve().parent
FALLBACK_PAGE = HERE / "fallback.html"


class ConfigError(ValueError):
    pass


def _expand(path: str, base: Path) -> Path:
    p = Path(os.path.expanduser(path))
    return p if p.is_absolute() else (base / p)


def load_config(path: Path, detected: dict | None = None, catalog_rows: list | None = None) -> dict:
    """Combine the installed catalog apps with the user's apps.json.

    apps.json is optional. It can add custom apps ("apps"), replace a catalog
    app by using its id, hide catalog apps ("hidden"), set the rows and the hero.
    Raises ConfigError with a readable message when apps.json is malformed.
    """
    raw: dict = {}
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError(f"cannot read {path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise ConfigError("config must be a JSON object")

    custom = raw.get("apps", {})
    if not isinstance(custom, dict):
        raise ConfigError('"apps" must be an object')
    hidden = raw.get("hidden", [])
    if not isinstance(hidden, list):
        raise ConfigError('"hidden" must be a list of app ids')

    apps = {k: v for k, v in (detected or {}).items() if k not in hidden}
    for app_id, app in custom.items():
        if not isinstance(app, dict):
            raise ConfigError(f"app {app_id!r} must be an object")
        cmd = app.get("command")
        if not (isinstance(cmd, list) and cmd and all(isinstance(c, str) and c for c in cmd)):
            raise ConfigError(f'app {app_id!r}: "command" must be a list of strings, e.g. ["nuvio-desktop"]')
        media = {}
        for key in ("icon", "backdrop"):
            if app.get(key):
                media[key] = _expand(str(app[key]), path.parent)
        base = apps.get(app_id, {})
        apps[app_id] = {
            "name": str(app.get("name") or base.get("name") or app_id),
            "subtitle": str(app.get("subtitle") or base.get("subtitle") or ""),
            "color": str(app.get("color") or base.get("color") or "#3b82f6"),
            "row": str(app.get("row") or base.get("row") or "Apps"),
            "command": cmd,
            "media": media or base.get("media", {}),
        }

    for app_id in hidden:
        apps.pop(app_id, None)

    rows = raw.get("rows")
    clean_rows = []
    if rows:
        for row in rows:
            ids = row.get("apps") if isinstance(row, dict) else None
            if not isinstance(ids, list):
                raise ConfigError('each row needs "title" and an "apps" list')
            # apps that are not installed (or unknown) are left out, not an error
            clean_rows.append({"title": str(row.get("title") or ""), "apps": [i for i in ids if i in apps]})
    else:
        order = list(catalog_rows or [])
        order += [a["row"] for a in apps.values() if a["row"] not in order]
        for title in order:
            ids = [app_id for app_id, a in apps.items() if a["row"] == title]
            if ids:
                clean_rows.append({"title": title, "apps": ids})

    order = raw.get("order", {})
    if not isinstance(order, dict):
        raise ConfigError('"order" must map row titles to lists of app ids')
    for row in clean_rows:
        wanted = order.get(row["title"])
        if isinstance(wanted, list):
            rank = {app_id: i for i, app_id in enumerate(wanted)}
            original = {app_id: i for i, app_id in enumerate(row["apps"])}
            row["apps"] = sorted(row["apps"], key=lambda a: rank.get(a, len(rank) + original[a]))

    hero = raw.get("hero")
    if hero is not None and not isinstance(hero, list):
        raise ConfigError('"hero" must be a list of app ids')
    hero = [h for h in (hero or []) if h in apps]
    if not hero:
        first = next((r["apps"][0] for r in clean_rows if r["apps"]), None)
        hero = [first] if first else []

    yt = raw.get("youtube", {})
    channels = yt.get("channels", []) if isinstance(yt, dict) else []
    if not (isinstance(channels, list) and all(isinstance(c, str) for c in channels)):
        raise ConfigError('"youtube": {"channels": [...]} must be a list of channel ids or @handles')
    return {"apps": apps, "rows": clean_rows, "hero": hero, "power": bool(raw.get("power", True)),
            "youtube_channels": channels, "continue_row": bool(raw.get("continue_row", False))}


def edit_user_config(path: Path, change) -> None:
    """Apply change(raw_dict) to apps.json, keeping everything else, written atomically."""
    raw = {}
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError(f"cannot read {path}: {exc}") from exc
    change(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def set_hidden(library, app_id: str, hidden: bool) -> None:
    known = set(library.detected) | set(library.get()["apps"]) | set(_raw_hidden(library.path))
    if app_id not in known:
        raise KeyError(app_id)

    def change(raw):
        current = [h for h in raw.get("hidden", []) if h != app_id]
        raw["hidden"] = current + [app_id] if hidden else current
    edit_user_config(library.path, change)
    library.invalidate()


def _raw_hidden(path: Path) -> list:
    try:
        return list(json.loads(path.read_text(encoding="utf-8")).get("hidden", []))
    except (OSError, ValueError, AttributeError):
        return []


def move_app(library, app_id: str, direction: str) -> None:
    cfg = library.get()
    row = next((r for r in cfg["rows"] if app_id in r["apps"]), None)
    if row is None or cfg["apps"].get(app_id, {}).get("kind") == "media":
        raise KeyError(app_id)
    ids = list(row["apps"])
    i = ids.index(app_id)
    j = {"left": i - 1, "right": i + 1, "first": 0, "last": len(ids) - 1}.get(direction)
    if j is None:
        raise ValueError(direction)
    j = max(0, min(len(ids) - 1, j))
    ids.insert(j, ids.pop(i))

    def change(raw):
        raw.setdefault("order", {})[row["title"]] = ids
    edit_user_config(library.path, change)
    library.invalidate()


CONTINUE_ROW = "Continue watching"


def _preview_id(prefix: str, key: str) -> str:
    return prefix + hashlib.sha1(key.encode()).hexdigest()[:12]


def add_previews(config: dict, detected: dict, continue_watching=None, youtube=None) -> dict:
    """Give apps their own content for the hero (Google TV style): Nuvio's Continue watching,
    the latest videos of your YouTube channels. Each preview is also a launchable entry."""
    apps = config["apps"]

    def attach(parent_id: str, entries: list[tuple[str, dict]]):
        ids = []
        for pid, entry in entries:
            apps[pid] = entry
            ids.append(pid)
        if ids:
            apps[parent_id] = {**apps[parent_id], "previews": ids}
        return ids

    nuvio_ids = []
    nuvio_app = apps.get("nuvio")
    if nuvio_app and continue_watching is not None:
        try:
            items = continue_watching()
        except Exception as exc:  # never let a format change upstream break the launcher
            print(f"xlab-tv: could not read Nuvio's progress: {exc}", file=sys.stderr)
            items = []
        nuvio_ids = attach("nuvio", [(
            _preview_id("cw-", f"{i['type']}:{i['metaId']}"),
            {"name": i["title"], "subtitle": i["subtitle"], "color": nuvio_app["color"], "parent": "nuvio",
             "row": CONTINUE_ROW, "command": [*nuvio_app["command"], nuvio.deep_link(i)], "media": {},
             "kind": "media", "progress": i["progress"], "eyebrow": "Continue watching in Nuvio",
             "art": {k: i[k] for k in ("backdrop", "poster", "thumbnail", "logo")}},
        ) for i in items])

    yt_app = apps.get("youtube")
    if yt_app and youtube is not None and config.get("youtube_channels"):
        try:
            videos = youtube(config["youtube_channels"])
        except Exception as exc:
            print(f"xlab-tv: could not read YouTube feeds: {exc}", file=sys.stderr)
            videos = []
        attach("youtube", [(
            _preview_id("yt-", v["videoId"]),
            {"name": v["title"], "subtitle": v["subtitle"], "color": yt_app["color"], "row": "YouTube",
             "parent": "youtube",
             "command": [*yt_app["command"], v["url"], "--fullscreen"], "media": {}, "kind": "media",
             "eyebrow": "New on YouTube",
             "art": {"backdrop": v["backdrop"], "thumbnail": v["backdrop"], "poster": "",
                     "logo": "", "backdropFallback": v["backdropFallback"]}},
        ) for v in videos])

    if nuvio_ids:
        if config.get("continue_row"):
            config["rows"] = [{"title": CONTINUE_ROW, "apps": nuvio_ids}] + config["rows"]
        # until an app is focused, the hero opens on what you were last watching
        config["hero"] = [nuvio_ids[0]] + [h for h in config["hero"] if h != nuvio_ids[0]]
    return config


class Library:
    """The current app list: installed apps are looked up again at most every 30 s."""

    def __init__(self, path: Path, catalog: dict | None = None, detect=None, ttl: float = 30.0,
                 continue_watching=None, youtube=None):
        self.path = path
        self.youtube = youtube
        self.catalog = catalog
        self.continue_watching = continue_watching if continue_watching is not None else nuvio.continue_watching
        self.detect = detect or (lambda: apps_catalog.detect(self.catalog) if self.catalog else {})
        self.ttl = ttl
        self._lock = threading.Lock()
        self._config: dict | None = None
        self._at = 0.0
        self._stale = True
        self.detected: dict = {}

    def invalidate(self) -> None:
        # a flag, not a timestamp: time.monotonic() counts from boot, so "long ago"
        # isn't reliably older than the TTL in the first seconds after a box starts
        with self._lock:
            self._stale = True

    def get(self) -> dict:
        with self._lock:
            now = time.monotonic()
            if self._config is None or self._stale or now - self._at > self.ttl:
                rows = self.catalog.get("rows") if self.catalog else None
                try:
                    self.detected = self.detect()
                    self._config = add_previews(load_config(self.path, self.detected, rows), self.detected,
                                                self.continue_watching, self.youtube)
                except ConfigError as exc:
                    if self._config is None:
                        raise
                    print(f"xlab-tv: {exc} (keeping the previous app list)", file=sys.stderr)
                self._at = now
                self._stale = False
            return self._config


def api_apps(config: dict) -> dict:
    """The /api/apps response: the shape the UI's src/mock.ts uses.

    Continue-watching items carry kind "media", progress (0-1) and artwork URLs
    (backdrop, poster, thumbnail, logo); apps carry kind "app".
    """
    apps = config["apps"]

    def media_url(app_id: str, key: str) -> str:
        return f"/media/{app_id}/{key}" if key in apps[app_id]["media"] else ""

    def art(app_id: str, key: str) -> str:
        return apps[app_id].get("art", {}).get(key, "")

    def hero(app_id: str) -> dict:
        a = apps[app_id]
        out = {
            "id": app_id,
            "appId": app_id,
            "title": a["name"],
            "subtitle": a["subtitle"],
            "backdrop": art(app_id, "backdrop") or media_url(app_id, "backdrop"),
            "kind": a.get("kind", "app"),
        }
        if a.get("kind") == "media":
            out.update(eyebrow=a.get("eyebrow", ""), logo=art(app_id, "logo"),
                       backdropFallback=art(app_id, "backdropFallback"))
            if "progress" in a:
                out["progress"] = a["progress"]
        return out

    def item(app_id: str) -> dict:
        a = apps[app_id]
        out = {
            "id": app_id,
            "name": a["name"],
            "subtitle": a["subtitle"],
            "icon": media_url(app_id, "icon"),
            "color": a["color"],
            "kind": a.get("kind", "app"),
        }
        if a.get("kind") == "media":
            out.update(progress=a.get("progress", 0), backdrop=art(app_id, "thumbnail") or art(app_id, "backdrop"),
                       poster=art(app_id, "poster"))
        if a.get("previews"):
            out["previews"] = [hero(p) for p in a["previews"]]
        return out

    return {
        "hero": [hero(app_id) for app_id in config["hero"]],
        "rows": [{"title": row["title"], "items": [item(i) for i in row["apps"]]} for row in config["rows"]],
        "power": config["power"],
    }


def process_tree(root: int, proc_dir: Path = Path("/proc")) -> list[int]:
    """root and all its descendants (an app's helpers, a Flatpak's sandboxed process)."""
    children: dict[int, list[int]] = {}
    for entry in proc_dir.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
        except OSError:
            continue
        # "pid (name) state ppid ...": the name may contain spaces or parentheses
        fields = stat[stat.rfind(")") + 2:].split()
        if len(fields) > 1 and fields[1].isdigit():
            children.setdefault(int(fields[1]), []).append(int(entry.name))
    found, todo = [], [root]
    while todo:
        pid = todo.pop()
        found.append(pid)
        todo.extend(children.get(pid, []))
    return found


def activate_pids(pids: list[int], run=subprocess.run) -> bool:
    """Bring forward the window owned by one of these processes (xLab TV GNOME extension)."""
    if not pids:
        return False
    try:
        out = run(["gdbus", "call", "--session", "--dest", "org.gnome.Shell",
                   "--object-path", "/tv/xlab/Shell", "--method", "tv.xlab.Shell.ActivatePids",
                   "@au [" + ", ".join(str(int(p)) for p in pids) + "]"],
                  capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0 and "true" in out.stdout


# Music keeps playing when another app opens (like Google TV); video is paused.
KEEP_PLAYING = ("spotify", "plexamp", "tidal", "shortwave", "ytmdesktop", "youtube-music")
MPRIS = "org.mpris.MediaPlayer2."


def pause_players(run=subprocess.run, keep=KEEP_PLAYING) -> list[str]:
    """Send MPRIS Pause to every media player on the session bus except music players.
    Returns the players asked to pause."""
    try:
        out = run(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                   "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.ListNames"],
                  capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    names = re.findall(r"'(org\.mpris\.MediaPlayer2\.[^']+)'", out.stdout)
    paused = []
    for name in names:
        player = name[len(MPRIS):].lower()
        if any(k in player for k in keep):
            continue
        try:
            run(["gdbus", "call", "--session", "--dest", name, "--object-path", "/org/mpris/MediaPlayer2",
                 "--method", "org.mpris.MediaPlayer2.Player.Pause"],
                capture_output=True, text=True, timeout=2)
            paused.append(name)
        except (OSError, subprocess.SubprocessError):
            continue
    return paused


OPENING_SECONDS = 8  # how long the UI may show "Opening…" after a launch


class Launcher:
    """Starts apps; several can be open at once. Opening one that is already open runs its
    command again, which brings it forward for single-instance apps (Nuvio, browsers, most
    Flatpaks); previews (a Nuvio title, a YouTube video) go to their app the same way."""

    def __init__(self, library, log_path: Path | None = None, clock=time.monotonic, activate=None,
                 pause=None):
        self.library = library
        # pauses whatever video is playing before another app comes forward
        self.pause = pause
        self.log_path = log_path
        self.clock = clock
        # brings an open app's window forward; None = can't (no GNOME extension)
        self.activate = activate
        self._lock = threading.Lock()
        self._procs: dict[str, subprocess.Popen] = {}   # app id -> first process started for it
        self._order: list[str] = []                     # most recently opened last
        self._opening: tuple[str, float] | None = None

    def _prune(self):
        for app_id, proc in list(self._procs.items()):
            if proc.poll() is not None:
                del self._procs[app_id]
                self._order = [a for a in self._order if a != app_id]

    def status(self) -> str | None:
        """The app being opened right now (for a few seconds after a launch), else None."""
        with self._lock:
            self._prune()
            if self._opening and self.clock() - self._opening[1] < OPENING_SECONDS:
                return self._opening[0]
            self._opening = None
            return None

    def open_apps(self) -> list[str]:
        with self._lock:
            self._prune()
            return list(self._order)

    def front(self) -> str | None:
        """The most recently opened app that is still running."""
        apps = self.open_apps()
        return apps[-1] if apps else None

    def launch(self, app_id: str) -> None:
        apps = self.library.get()["apps"]
        app = apps.get(app_id)
        if app is None:
            raise KeyError(app_id)
        owner = app.get("parent", app_id)  # a preview belongs to its app
        if self.pause is not None:
            self.pause()  # one thing plays at a time: the app being left stops talking
        with self._lock:
            self._prune()
            running = self._procs.get(owner)
        if running is not None and self.activate is not None:
            pids = process_tree(running.pid)
            if owner == app_id:
                # the app itself is already open: just bring its window back
                if self.activate(pids):
                    with self._lock:
                        self._order = [a for a in self._order if a != owner] + [owner]
                        self._opening = None
                    return
            else:
                # a preview of an open app: hand it over (below), then show that app's window
                threading.Timer(1.0, self.activate, args=(pids,)).start()
        log = open(self.log_path, "ab") if self.log_path else subprocess.DEVNULL
        try:
            proc = subprocess.Popen(
                app["command"],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except OSError as exc:
            raise RuntimeError(f"could not start {app['name']}: {exc.strerror or exc}") from exc
        finally:
            if log is not subprocess.DEVNULL:
                log.close()
        with self._lock:
            self._prune()
            if owner not in self._procs:
                self._procs[owner] = proc
            else:
                # Already open: this second start hands over to the open window and exits;
                # reap it in the background so it doesn't linger as a zombie.
                threading.Thread(target=proc.wait, daemon=True).start()
            self._order = [a for a in self._order if a != owner] + [owner]
            self._opening = (app_id, self.clock())

    def stop(self, app_id: str | None = None) -> bool:
        """Close an app (default: the most recently opened one). True if one was running."""
        with self._lock:
            self._prune()
            target = app_id or (self._order[-1] if self._order else None)
            proc = self._procs.get(target) if target else None
        if proc is None or proc.poll() is not None:
            return False
        try:
            os.killpg(proc.pid, signal.SIGTERM)   # its own session: the app and its helpers
        except ProcessLookupError:
            return False
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        with self._lock:
            self._prune()
        return True


def show_launcher(run=subprocess.run) -> bool:
    """Bring the launcher window forward through the xLab TV GNOME extension."""
    try:
        out = run(["gdbus", "call", "--session", "--dest", "org.gnome.Shell",
                   "--object-path", "/tv/xlab/Shell", "--method", "tv.xlab.Shell.ShowLauncher"],
                  capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0 and "true" in out.stdout


def make_handler(library, launcher: Launcher, ui_dir: Path | None, token: str, port_ref: list,
                 on_exit=None, run=subprocess.Popen, store=None, remote=None, settings=None,
                 updates=None):

    class Handler(BaseHTTPRequestHandler):
        server_version = "xlab-tv"

        def log_message(self, fmt, *args):  # keep the journal quiet
            pass

        # ---- helpers -------------------------------------------------
        def _host_ok(self) -> bool:
            port = port_ref[0]
            host = self.headers.get("Host", "")
            if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status: int, data: dict) -> None:
            self._send(status, json.dumps(data).encode(), "application/json")

        def _token_ok(self) -> bool:
            return secrets.compare_digest(self.headers.get("X-XLab-Token", ""), token)

        # ---- GET -----------------------------------------------------
        def do_GET(self):
            if not self._host_ok():
                return self._send(403, b"forbidden", "text/plain")
            path = unquote(urlsplit(self.path).path)
            if path.startswith("/api/"):
                if not self._token_ok():
                    return self._json(401, {"ok": False, "error": "bad token"})
                if path == "/api/apps":
                    return self._json(200, api_apps(library.get()))
                if path == "/api/status":
                    return self._json(200, {"running": launcher.status(), "open": launcher.open_apps()})
                if path == "/api/remote" and remote is not None:
                    return self._json(200, remote.info())
                if path == "/api/updates" and updates is not None:
                    return self._json(200, updates.get())
                if path == "/api/apps/hidden":
                    library.get()
                    hidden = _raw_hidden(library.path)
                    names = {**{k: v["name"] for k, v in library.detected.items()}}
                    return self._json(200, {"apps": [{"id": h, "name": names.get(h, h)} for h in hidden]})
                if path.startswith("/api/settings/") and settings is not None:
                    getter = settings.get(path.rsplit("/", 1)[-1], (None, None))[0]
                    if getter is None:
                        return self._json(404, {"ok": False, "error": "not found"})
                    try:
                        return self._json(200, getter())
                    except settings_mod.SettingsError as exc:
                        return self._json(503, {"ok": False, "error": str(exc)})
                if path == "/api/store" and store is not None:
                    library.get()
                    return self._json(200, {"items": store.items(library.detected)})
                return self._json(404, {"ok": False, "error": "not found"})
            if path.startswith("/media/"):
                parts = path.split("/")
                media = None
                if len(parts) == 4:
                    media = library.get()["apps"].get(parts[2], {}).get("media", {}).get(parts[3])
                    if media is None and parts[3] == "icon" and store is not None:
                        media = store.icon_path(parts[2])
                if media is None or not media.is_file():
                    return self._send(404, b"not found", "text/plain")
                ctype = mimetypes.guess_type(media.name)[0] or "application/octet-stream"
                return self._send(200, media.read_bytes(), ctype)
            return self._static(path)

        do_HEAD = do_GET

        def _static(self, path: str):
            if ui_dir is None:
                return self._page(FALLBACK_PAGE)
            root = ui_dir.resolve()
            target = (root / path.lstrip("/")).resolve()
            if root not in target.parents and target != root:
                return self._send(404, b"not found", "text/plain")
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                # single-page app: unknown paths get the index page
                target = root / "index.html"
            if target.name == "index.html":
                return self._page(target)
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            return self._send(200, target.read_bytes(), ctype)

        def _page(self, page: Path):
            html = page.read_text(encoding="utf-8")
            meta = f'<meta name="xlab-token" content="{token}">'
            # Replace an existing (empty) token tag, else add one at the top of <head>.
            html, n = re.subn(r'<meta\s+name="xlab-token"[^>]*>', meta, html, count=1)
            if not n:
                html = html.replace("<head>", "<head>" + meta, 1) if "<head>" in html else meta + html
            self._send(200, html.encode(), "text/html; charset=utf-8")

        # ---- POST ----------------------------------------------------
        def do_POST(self):
            if not self._host_ok():
                return self._send(403, b"forbidden", "text/plain")
            if not self._token_ok():
                return self._json(401, {"ok": False, "error": "bad token"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 < length <= MAX_BODY:
                return self._json(400, {"ok": False, "error": "bad request"})
            try:
                body = json.loads(self.rfile.read(length))
                assert isinstance(body, dict)
            except Exception:
                return self._json(400, {"ok": False, "error": "bad json"})

            path = urlsplit(self.path).path
            if path == "/api/launch":
                try:
                    launcher.launch(str(body.get("id", "")))
                except KeyError:
                    return self._json(404, {"ok": False, "error": "unknown app"})
                except RuntimeError as exc:
                    return self._json(409, {"ok": False, "error": str(exc)})
                return self._json(200, {"ok": True})
            if path in ("/api/apps/hide", "/api/apps/move"):
                try:
                    if path.endswith("hide"):
                        set_hidden(library, str(body.get("id", "")), bool(body.get("hidden", True)))
                    else:
                        move_app(library, str(body.get("id", "")), str(body.get("direction", "")))
                except KeyError:
                    return self._json(404, {"ok": False, "error": "unknown app"})
                except ValueError:
                    return self._json(400, {"ok": False, "error": "direction must be left, right, first or last"})
                except ConfigError as exc:
                    return self._json(500, {"ok": False, "error": str(exc)})
                return self._json(200, {"ok": True})
            if path == "/api/settings/open" and settings is not None:
                try:
                    settings_mod.open_settings_page(str(body.get("page", "")))
                except settings_mod.SettingsError as exc:
                    return self._json(400, {"ok": False, "error": str(exc)})
                return self._json(200, {"ok": True})
            if path.startswith("/api/settings/") and settings is not None:
                action = settings.get(path.rsplit("/", 1)[-1], (None, None))[1]
                if action is None:
                    return self._json(404, {"ok": False, "error": "not found"})
                try:
                    return self._json(200, {"ok": True, **action(body)})
                except settings_mod.SettingsError as exc:
                    return self._json(409, {"ok": False, "error": str(exc)})
                except (TypeError, ValueError):
                    return self._json(400, {"ok": False, "error": "bad value"})
            if path == "/api/close":
                if not launcher.stop(str(body.get("id", ""))):
                    return self._json(404, {"ok": False, "error": "that app is not open"})
                return self._json(200, {"ok": True})
            if path == "/api/remote" and remote is not None:
                if body.get("action") != "forget":
                    return self._json(400, {"ok": False, "error": "action must be forget"})
                remote.forget()
                return self._json(200, {"ok": True})
            if path == "/api/store" and store is not None:
                try:
                    store.request(str(body.get("id", "")), str(body.get("action", "")))
                except KeyError:
                    return self._json(404, {"ok": False, "error": "unknown app"})
                except ValueError:
                    return self._json(400, {"ok": False, "error": "action must be install or remove"})
                except RuntimeError as exc:
                    return self._json(409, {"ok": False, "error": str(exc)})
                return self._json(202, {"ok": True})
            if path == "/api/power":
                action = body.get("action")
                if action == "exit" and on_exit:
                    self._json(200, {"ok": True})
                    threading.Thread(target=on_exit, daemon=True).start()
                    return None
                if not library.get()["power"] or action not in POWER_COMMANDS:
                    return self._json(400, {"ok": False, "error": "power action not allowed"})
                try:
                    run(POWER_COMMANDS[action], stdin=subprocess.DEVNULL)
                except OSError as exc:
                    return self._json(500, {"ok": False, "error": str(exc)})
                return self._json(200, {"ok": True})
            return self._json(404, {"ok": False, "error": "not found"})

    return Handler


class RemoteControl:
    """What the TV needs to show the phone remote's pairing screen."""

    def __init__(self, pairing, vinput, port: int):
        self.pairing, self.vinput, self.port = pairing, vinput, port

    def info(self) -> dict:
        code, left = self.pairing.code()
        url = f"http://{remote_mod.lan_address()}:{self.port}/remote"
        return {"url": url, "pairUrl": f"{url}#pair={code}", "code": code, "expiresIn": left,
                "devices": len(self.pairing.devices), "inputError": self.vinput.error,
                "wake": remote_mod.wake_info()}

    def forget(self) -> None:
        self.pairing.forget_all()


def run_power_action(action: str) -> None:
    if action not in POWER_COMMANDS:
        raise KeyError(action)
    subprocess.Popen(POWER_COMMANDS[action], stdin=subprocess.DEVNULL)


def start_remote(port: int, library, launcher, ui_dir):
    config_dir = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "xlab-tv"
    pairing = remote_mod.Pairing(config_dir / "remotes.json")
    vinput = remote_mod.VirtualInput()
    threading.Thread(target=vinput.warm, daemon=True).start()
    handler = remote_mod.make_remote_handler(pairing, vinput, library, launcher,
                                             HERE / "remote.html", ui_dir, run_power_action,
                                             go_home=show_launcher)
    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    except OSError as exc:
        print(f"xlab-tv: phone remote off, port {port} unavailable ({exc.strerror})", file=sys.stderr)
        return None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"xlab-tv: phone remote on http://{remote_mod.lan_address()}:{port}/remote", flush=True)
    return RemoteControl(pairing, vinput, port)


def default_config_path() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "xlab-tv" / "apps.json"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="xLab TV launcher service")
    ap.add_argument("--config", type=Path, default=default_config_path())
    ap.add_argument("--ui", type=Path, default=None, help="built UI folder (contains index.html)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--log", type=Path, default=None, help="file for app output")
    ap.add_argument("--check", action="store_true", help="validate the config and exit")
    ap.add_argument("--port-file", type=Path, default=None, help="write the port in use here")
    ap.add_argument("--remote-port", type=int, default=8766, help="phone remote on the home network (0 = off)")
    args = ap.parse_args(argv)

    catalog = apps_catalog.load_catalog()
    cache_root = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "xlab-tv"
    feeds = youtube.YouTubeFeeds(cache_root)
    library = Library(args.config, catalog, youtube=feeds.get)
    try:
        config = library.get()
    except ConfigError as exc:
        print(f"xlab-tv: {exc}", file=sys.stderr)
        return 2
    if args.check:
        names = ", ".join(a["name"] for a in config["apps"].values()) or "none yet"
        print(f"xlab-tv: config OK. Apps found: {names}")
        return 0
    ui_dir = args.ui if args.ui and (args.ui / "index.html").is_file() else None
    if args.ui and ui_dir is None:
        print(f"xlab-tv: no index.html in {args.ui}, using the built-in page", file=sys.stderr)

    token = secrets.token_urlsafe(24)
    port_ref = [args.port]
    launcher = Launcher(library, args.log, activate=activate_pids, pause=pause_players)
    httpd: ThreadingHTTPServer

    def stop():
        httpd.shutdown()

    cache = cache_root / "icons"
    store = apps_catalog.Store(catalog, cache, on_change=library.invalidate)
    remote = None
    if args.remote_port:
        remote = start_remote(args.remote_port, library, launcher, ui_dir)
    quick_settings = {
        "wifi": (settings_mod.wifi_status, settings_mod.wifi_action),
        "bluetooth": (settings_mod.bluetooth_status, settings_mod.bluetooth_action),
        "audio": (settings_mod.audio_status, settings_mod.audio_action),
    }
    updates = settings_mod.UpdateChecker()
    handler = make_handler(library, launcher, ui_dir, token, port_ref, on_exit=stop, store=store,
                           remote=remote, settings=quick_settings, updates=updates)
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as exc:
        # Port taken (by a leftover or another program): use any free port instead.
        print(f"xlab-tv: port {args.port} unavailable ({exc.strerror}), picking a free one", file=sys.stderr)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port_ref[0] = httpd.server_address[1]
    if args.port_file:
        args.port_file.write_text(str(port_ref[0]))
    print(f"xlab-tv: listening on http://127.0.0.1:{port_ref[0]}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # log it for session.log instead of a crash dialog
        import traceback
        traceback.print_exc()
        sys.exit(1)
