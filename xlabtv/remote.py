#!/usr/bin/env python3
"""Phone remote for xLab TV.

A second, small web server on the home network (port 8766) serves the remote page
and its API. A phone pairs once with a 6-digit code shown on the TV (or the QR code
that carries it) and gets its own token. Its keys, typing and touchpad go to a
virtual keyboard and mouse (uinput), so they reach every app, not only the launcher.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_BODY = 4096
CODE_TTL = 300          # a pairing code is good for 5 minutes...
CODE_TRIES = 5          # ...or 5 wrong guesses, whichever comes first

# remote button -> Linux key name
KEYS = {
    "up": "KEY_UP", "down": "KEY_DOWN", "left": "KEY_LEFT", "right": "KEY_RIGHT",
    "ok": "KEY_ENTER", "back": "KEY_ESC", "playpause": "KEY_PLAYPAUSE",
    "volup": "KEY_VOLUMEUP", "voldown": "KEY_VOLUMEDOWN", "mute": "KEY_MUTE",
    "space": "KEY_SPACE", "backspace": "KEY_BACKSPACE", "tab": "KEY_TAB",
    "fullscreen": "KEY_F11",
}

# US layout: character -> (key name, shift)
_SHIFTED = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8",
            "(": "9", ")": "0", "_": "MINUS", "+": "EQUAL", "{": "LEFTBRACE", "}": "RIGHTBRACE",
            "|": "BACKSLASH", ":": "SEMICOLON", '"': "APOSTROPHE", "<": "COMMA", ">": "DOT",
            "?": "SLASH", "~": "GRAVE"}
_PLAIN = {" ": "SPACE", "-": "MINUS", "=": "EQUAL", "[": "LEFTBRACE", "]": "RIGHTBRACE",
          "\\": "BACKSLASH", ";": "SEMICOLON", "'": "APOSTROPHE", ",": "COMMA", ".": "DOT",
          "/": "SLASH", "`": "GRAVE", "\n": "ENTER"}


def char_key(ch: str) -> tuple[str, bool] | None:
    if "a" <= ch <= "z" or "0" <= ch <= "9":
        return f"KEY_{ch.upper()}", False
    if "A" <= ch <= "Z":
        return f"KEY_{ch}", True
    if ch in _PLAIN:
        return f"KEY_{_PLAIN[ch]}", False
    if ch in _SHIFTED:
        return f"KEY_{_SHIFTED[ch]}", True
    return None


class VirtualInput:
    """A virtual keyboard and mouse. `backend` is created lazily so the service runs
    (with the remote reporting why) when uinput is unavailable."""

    def __init__(self, backend_factory=None):
        self._factory = backend_factory or _evdev_backend
        self._backend = None
        self._lock = threading.Lock()
        self.error: str | None = None

    def _get(self):
        if self._backend is None and self.error is None:
            try:
                self._backend = self._factory()
            except Exception as exc:  # no python3-evdev, or no permission on /dev/uinput
                self.error = f"virtual keyboard unavailable: {exc}"
        if self._backend is None:
            raise RuntimeError(self.error or "virtual keyboard unavailable")
        return self._backend

    def warm(self) -> None:
        """Create the devices now, so the TV and phone can say early if it failed."""
        try:
            with self._lock:
                self._get()
        except RuntimeError:
            pass

    def key(self, name: str) -> None:
        if name not in KEYS:
            raise KeyError(name)
        with self._lock:
            b = self._get()
            b.tap(KEYS[name])

    def text(self, text: str) -> int:
        typed = 0
        with self._lock:
            b = self._get()
            for ch in text[:500]:
                mapped = char_key(ch)
                if mapped is None:
                    continue
                key, shift = mapped
                b.tap(key, shift)
                typed += 1
        return typed

    def move(self, dx: int, dy: int) -> None:
        with self._lock:
            self._get().move(max(-500, min(500, dx)), max(-500, min(500, dy)))

    def click(self, button: str) -> None:
        if button not in ("left", "right", "middle"):
            raise KeyError(button)
        with self._lock:
            self._get().click(button)

    def scroll(self, dy: int) -> None:
        with self._lock:
            self._get().scroll(max(-20, min(20, dy)))


def _evdev_backend():
    from evdev import UInput, ecodes as e  # python3-evdev

    key_codes = sorted({getattr(e, k) for k in KEYS.values()} |
                       {getattr(e, f"KEY_{c}") for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"} |
                       {getattr(e, f"KEY_{n}") for n in list(_PLAIN.values()) + list(_SHIFTED.values())
                        if not n.isdigit()} | {e.KEY_LEFTSHIFT})
    keyboard = UInput({e.EV_KEY: key_codes}, name="xLab TV Remote Keyboard")
    mouse = UInput({e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE],
                    e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL]}, name="xLab TV Remote Mouse")
    buttons = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}

    class Backend:
        def tap(self, key: str, shift: bool = False):
            code = getattr(e, key)
            if shift:
                keyboard.write(e.EV_KEY, e.KEY_LEFTSHIFT, 1)
            keyboard.write(e.EV_KEY, code, 1)
            keyboard.syn()
            keyboard.write(e.EV_KEY, code, 0)
            if shift:
                keyboard.write(e.EV_KEY, e.KEY_LEFTSHIFT, 0)
            keyboard.syn()

        def move(self, dx, dy):
            mouse.write(e.EV_REL, e.REL_X, dx)
            mouse.write(e.EV_REL, e.REL_Y, dy)
            mouse.syn()

        def click(self, button):
            mouse.write(e.EV_KEY, buttons[button], 1)
            mouse.syn()
            mouse.write(e.EV_KEY, buttons[button], 0)
            mouse.syn()

        def scroll(self, dy):
            mouse.write(e.EV_REL, e.REL_WHEEL, -dy)
            mouse.syn()

    time.sleep(0.3)  # let the desktop pick up the new devices before the first key
    return Backend()


class Pairing:
    """Pairing codes for new phones and the tokens of paired ones (kept on disk)."""

    def __init__(self, store: Path, clock=time.monotonic):
        self.store = store
        self.clock = clock
        self._lock = threading.Lock()
        self._code = ""
        self._code_at = 0.0
        self._tries = 0
        self.devices: dict[str, dict] = {}
        try:
            self.devices = json.loads(store.read_text())["devices"]
        except (OSError, ValueError, KeyError, TypeError):
            self.devices = {}

    def code(self) -> tuple[str, int]:
        """The current code and its seconds left; a fresh one when it ran out."""
        with self._lock:
            now = self.clock()
            if not self._code or now - self._code_at > CODE_TTL or self._tries >= CODE_TRIES:
                self._code = f"{secrets.randbelow(1_000_000):06d}"
                self._code_at, self._tries = now, 0
            return self._code, int(CODE_TTL - (now - self._code_at))

    def pair(self, code: str, name: str) -> str | None:
        with self._lock:
            now = self.clock()
            valid = self._code and now - self._code_at <= CODE_TTL and self._tries < CODE_TRIES
            if not valid:
                return None
            if not secrets.compare_digest(code, self._code):
                self._tries += 1
                return None
            token = secrets.token_urlsafe(32)
            self.devices[token] = {"name": name[:40] or "Phone", "paired": int(time.time())}
            self._code = ""  # one code, one phone
            self._save()
            return token

    def check(self, token: str) -> bool:
        return bool(token) and any(secrets.compare_digest(token, t) for t in list(self.devices))

    def forget_all(self) -> None:
        with self._lock:
            self.devices = {}
            self._save()

    def _save(self):
        self.store.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.store.with_suffix(".tmp")
        tmp.write_text(json.dumps({"devices": self.devices}))
        os.chmod(tmp, 0o600)
        tmp.replace(self.store)


def lan_address() -> str:
    """This computer's address on the home network (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # TEST-NET address: picks the default route's interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_remote_handler(pairing: Pairing, vinput: VirtualInput, library, launcher, page: Path,
                        ui_dir: Path | None = None, run_power=None):
    """Handler for the home-network server. It never serves the launcher's own token."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "xlab-tv-remote"

        def log_message(self, fmt, *args):
            pass

        def _send(self, status, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status, data):
            self._send(status, json.dumps(data).encode(), "application/json")

        def _authed(self) -> bool:
            return pairing.check(self.headers.get("X-Remote-Token", ""))

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == "/remote/apps":
                if not self._authed():
                    return self._json(401, {"ok": False, "error": "not paired"})
                cfg = library.get()
                apps = [{"id": i, "name": a["name"], "color": a["color"],
                         "icon": f"/remote/icon/{i}" if a["media"].get("icon") else ""}
                        for i, a in cfg["apps"].items()]
                return self._json(200, {"apps": apps, "running": launcher.status(),
                                        "input": vinput.error is None})
            if path.startswith("/remote/icon/"):
                # icons are not secret; they let the remote show app tiles
                app = library.get()["apps"].get(path.rsplit("/", 1)[-1], {})
                icon = app.get("media", {}).get("icon") if app else None
                if not icon or not Path(icon).is_file():
                    return self._send(404, b"not found", "text/plain")
                ctype = "image/svg+xml" if str(icon).endswith(".svg") else "image/png"
                return self._send(200, Path(icon).read_bytes(), ctype)
            # The remote page: AI Studio's build (its /remote route) or the built-in page.
            if ui_dir is not None and (ui_dir / "index.html").is_file():
                root = ui_dir.resolve()
                target = (root / path.lstrip("/")).resolve()
                if (root in target.parents) and target.is_file() and target.name != "index.html":
                    import mimetypes
                    ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                    return self._send(200, target.read_bytes(), ctype)
                if path.startswith("/remote"):
                    return self._send(200, (root / "index.html").read_bytes(), "text/html; charset=utf-8")
            return self._send(200, page.read_bytes(), "text/html; charset=utf-8")

        do_HEAD = do_GET

        def do_POST(self):
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

            if path == "/remote/pair":
                token = pairing.pair(str(body.get("code", "")).strip(), str(body.get("name", "")))
                if token is None:
                    return self._json(403, {"ok": False, "error": "wrong or expired code"})
                return self._json(200, {"ok": True, "token": token})

            if not self._authed():
                return self._json(401, {"ok": False, "error": "not paired"})
            try:
                if path == "/remote/key":
                    name = str(body.get("key", ""))
                    if name == "home":
                        launcher.stop()   # close the app in front: the launcher shows again
                    else:
                        vinput.key(name)
                elif path == "/remote/text":
                    vinput.text(str(body.get("text", "")))
                elif path == "/remote/mouse":
                    if "click" in body:
                        vinput.click(str(body["click"]))
                    elif "scroll" in body:
                        vinput.scroll(int(body["scroll"]))
                    else:
                        vinput.move(int(body.get("dx", 0)), int(body.get("dy", 0)))
                elif path == "/remote/launch":
                    launcher.launch(str(body.get("id", "")))
                elif path == "/remote/power":
                    action = str(body.get("action", ""))
                    if run_power is None or not library.get()["power"]:
                        return self._json(400, {"ok": False, "error": "power actions are off"})
                    run_power(action)
                else:
                    return self._json(404, {"ok": False, "error": "not found"})
            except KeyError:
                return self._json(404, {"ok": False, "error": "unknown key, button or app"})
            except (ValueError, TypeError):
                return self._json(400, {"ok": False, "error": "bad value"})
            except RuntimeError as exc:
                return self._json(409, {"ok": False, "error": str(exc)})
            return self._json(200, {"ok": True})

    return Handler
