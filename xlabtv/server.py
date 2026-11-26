#!/usr/bin/env python3
"""xLab TV local service.

Serves the launcher UI and a small JSON API that lists the configured apps,
launches them and handles power actions. It listens on 127.0.0.1 only, checks
the Host header (against DNS rebinding) and requires a per-run token that is
injected into the UI page, so other web pages cannot drive it.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import apps as apps_catalog  # noqa: E402  (xlabtv/apps.py, beside this file)

MAX_BODY = 4096
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

    hero = raw.get("hero")
    if hero is not None and not isinstance(hero, list):
        raise ConfigError('"hero" must be a list of app ids')
    hero = [h for h in (hero or []) if h in apps]
    if not hero:
        first = next((r["apps"][0] for r in clean_rows if r["apps"]), None)
        hero = [first] if first else []

    return {"apps": apps, "rows": clean_rows, "hero": hero, "power": bool(raw.get("power", True))}


class Library:
    """The current app list: installed apps are looked up again at most every 30 s."""

    def __init__(self, path: Path, catalog: dict | None = None, detect=None, ttl: float = 30.0):
        self.path = path
        self.catalog = catalog
        self.detect = detect or (lambda: apps_catalog.detect(self.catalog) if self.catalog else {})
        self.ttl = ttl
        self._lock = threading.Lock()
        self._config: dict | None = None
        self._at = 0.0
        self.detected: dict = {}

    def invalidate(self) -> None:
        with self._lock:
            self._at = 0.0

    def get(self) -> dict:
        with self._lock:
            now = time.monotonic()
            if self._config is None or now - self._at > self.ttl:
                rows = self.catalog.get("rows") if self.catalog else None
                try:
                    self.detected = self.detect()
                    self._config = load_config(self.path, self.detected, rows)
                except ConfigError as exc:
                    if self._config is None:
                        raise
                    print(f"xlab-tv: {exc} (keeping the previous app list)", file=sys.stderr)
                self._at = now
            return self._config


def api_apps(config: dict) -> dict:
    """The /api/apps response: the shape the UI's src/mock.ts uses."""
    apps = config["apps"]

    def media_url(app_id: str, key: str) -> str:
        return f"/media/{app_id}/{key}" if key in apps[app_id]["media"] else ""

    return {
        "hero": [
            {
                "id": app_id,
                "appId": app_id,
                "title": apps[app_id]["name"],
                "subtitle": apps[app_id]["subtitle"],
                "backdrop": media_url(app_id, "backdrop"),
            }
            for app_id in config["hero"]
        ],
        "rows": [
            {
                "title": row["title"],
                "items": [
                    {
                        "id": app_id,
                        "name": apps[app_id]["name"],
                        "subtitle": apps[app_id]["subtitle"],
                        "icon": media_url(app_id, "icon"),
                        "color": apps[app_id]["color"],
                    }
                    for app_id in row["apps"]
                ],
            }
            for row in config["rows"]
        ],
        "power": config["power"],
    }


class Launcher:
    """Runs one app at a time and reports which one is in front."""

    def __init__(self, library, log_path: Path | None = None):
        self.library = library
        self.log_path = log_path
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._running: str | None = None

    def status(self) -> str | None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is not None:
                self._proc, self._running = None, None
            return self._running

    def launch(self, app_id: str) -> None:
        apps = self.library.get()["apps"]
        app = apps.get(app_id)
        if app is None:
            raise KeyError(app_id)
        running = self.status()
        if running is not None:
            name = apps.get(running, {}).get("name", running)
            raise RuntimeError(f"{name} is already open")
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
            self._proc, self._running = proc, app_id


def make_handler(library, launcher: Launcher, ui_dir: Path | None, token: str, port_ref: list,
                 on_exit=None, run=subprocess.Popen, store=None):

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
                    return self._json(200, {"running": launcher.status()})
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
    args = ap.parse_args(argv)

    catalog = apps_catalog.load_catalog()
    library = Library(args.config, catalog)
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
    launcher = Launcher(library, args.log)
    httpd: ThreadingHTTPServer

    def stop():
        httpd.shutdown()

    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "xlab-tv" / "icons"
    store = apps_catalog.Store(catalog, cache, on_change=library.invalidate)
    handler = make_handler(library, launcher, ui_dir, token, port_ref, on_exit=stop, store=store)
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
