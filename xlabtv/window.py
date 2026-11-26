#!/usr/bin/env python3
"""xLab TV's own full-screen window: a GTK 4 + WebKit view of the launcher UI.

Usage: window.py http://127.0.0.1:8765/

It stays on the launcher's own address, hides the mouse pointer, has no menus,
and reloads by itself if the page fails to load or its web process crashes.
Running it again while it is open only brings the existing window forward.
"""
import sys
from urllib.parse import urlsplit

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import GLib, Gtk, WebKit  # noqa: E402

APP_ID = "tv.xlab.Launcher"


def same_origin(a: str, b: str) -> bool:
    pa, pb = urlsplit(a), urlsplit(b)
    return (pa.scheme, pa.netloc) == (pb.scheme, pb.netloc)


class Launcher(Gtk.Application):
    def __init__(self, url: str):
        super().__init__(application_id=APP_ID)
        self.url = url
        self.window = None
        self.view = None

    def do_activate(self):
        if self.window is not None:
            self.window.present()
            return

        settings = WebKit.Settings()
        settings.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
        settings.set_media_playback_requires_user_gesture(False)
        settings.set_enable_developer_extras(False)
        settings.set_enable_back_forward_navigation_gestures(False)

        view = WebKit.WebView(settings=settings)
        view.set_background_color(_rgba("#090B10"))
        view.connect("context-menu", lambda *a: True)          # no right-click menu
        view.connect("decide-policy", self._on_policy)
        view.connect("permission-request", self._on_permission)
        view.connect("load-failed", self._on_load_failed)
        view.connect("web-process-terminated", self._on_crash)
        view.connect("create", lambda *a: None)                # no pop-up windows

        win = Gtk.ApplicationWindow(application=self, title="xLab TV")
        win.set_decorated(False)
        win.set_cursor_from_name("none")
        win.set_child(view)
        win.fullscreen()
        win.present()

        self.window, self.view = win, view
        view.load_uri(self.url)
        view.grab_focus()

    # Stay on the launcher: links to anywhere else are ignored.
    def _on_policy(self, view, decision, kind):
        if kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not same_origin(uri, self.url):
                decision.ignore()
                return True
        if kind == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
            decision.ignore()
            return True
        return False

    def _on_permission(self, view, request):
        request.deny()  # notifications, camera, location: never needed
        return True

    def _on_load_failed(self, view, event, uri, error):
        # A blocked link or cancelled load is not a failure of the launcher.
        if not same_origin(uri, self.url) or "Policy" in (error.domain or ""):
            return False
        # The service may still be starting: try again shortly.
        GLib.timeout_add_seconds(2, self._reload)
        return True

    def _on_crash(self, view, reason):
        print(f"xlab-tv window: web process ended ({reason.value_nick}), reloading", file=sys.stderr)
        GLib.timeout_add_seconds(1, self._reload)

    def _reload(self):
        if self.view is not None:
            self.view.load_uri(self.url)
        return False


def _rgba(spec: str):
    gi.require_version("Gdk", "4.0")
    from gi.repository import Gdk

    color = Gdk.RGBA()
    color.parse(spec)
    return color


def main(argv) -> int:
    if len(argv) != 2 or urlsplit(argv[1]).scheme not in ("http", "https"):
        print("usage: window.py http://127.0.0.1:8765/", file=sys.stderr)
        return 2
    return Launcher(argv[1]).run(None)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
