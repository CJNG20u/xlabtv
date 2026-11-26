import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import server  # noqa: E402

TOKEN = "test-token"


def write_config(folder: Path, data: dict) -> Path:
    path = folder / "apps.json"
    path.write_text(json.dumps(data))
    return path


DETECTED = {
    "youtube": {"name": "YouTube", "subtitle": "", "color": "#f00", "row": "Watch",
                "command": ["flatpak", "run", "rocks.shy.VacuumTube"], "media": {}},
    "kodi": {"name": "Kodi", "subtitle": "", "color": "#0ff", "row": "Watch", "command": ["kodi"], "media": {}},
    "spotify": {"name": "Spotify", "subtitle": "", "color": "#0f0", "row": "Music",
                "command": ["flatpak", "run", "com.spotify.Client"], "media": {}},
}

BASE = {
    "rows": [{"title": "Apps", "apps": ["sleeper", "missing"]}],
    "apps": {
        "sleeper": {"name": "Sleeper", "command": [sys.executable, "-c", "import time; time.sleep(30)"],
                    "icon": "icon.png"},
        "missing": {"name": "Missing", "command": ["/nonexistent/xlab-binary"]},
    },
}


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_example_config_is_valid(self):
        cfg = server.load_config(Path(__file__).resolve().parents[1] / "apps.example.json")
        self.assertEqual(cfg["apps"], {})  # no custom apps: they come from the catalog

    def test_missing_config_is_fine(self):
        cfg = server.load_config(self.dir / "nope.json", {"kodi": DETECTED["kodi"]})
        self.assertEqual(cfg["rows"], [{"title": "Watch", "apps": ["kodi"]}])
        self.assertEqual(cfg["hero"], ["kodi"])

    def test_unknown_or_missing_app_in_row_is_skipped(self):
        cfg = server.load_config(write_config(self.dir, dict(BASE, rows=[{"title": "x", "apps": ["nope", "sleeper"]}])))
        self.assertEqual(cfg["rows"], [{"title": "x", "apps": ["sleeper"]}])

    def test_detected_apps_rows_hidden_and_override(self):
        user = {"hidden": ["kodi"], "apps": {"spotify": {"command": ["my-spotify"]}, "mine": {"command": ["x"]}}}
        cfg = server.load_config(write_config(self.dir, user), dict(DETECTED), ["Watch", "Music"])
        self.assertNotIn("kodi", cfg["apps"])
        self.assertEqual(cfg["apps"]["spotify"]["command"], ["my-spotify"])
        self.assertEqual(cfg["apps"]["spotify"]["name"], "Spotify")  # kept from the catalog
        self.assertEqual([r["title"] for r in cfg["rows"]], ["Watch", "Music", "Apps"])
        self.assertEqual(cfg["hero"], ["youtube"])

    def test_command_must_be_list(self):
        bad = {"apps": {"a": {"command": "rm -rf /"}}}
        with self.assertRaises(server.ConfigError):
            server.load_config(write_config(self.dir, bad))

    def test_hero_defaults_to_first_app(self):
        cfg = server.load_config(write_config(self.dir, BASE))
        self.assertEqual(cfg["hero"], ["sleeper"])

    def test_api_shape_matches_ui_contract(self):
        cfg = server.load_config(write_config(self.dir, BASE))
        data = server.api_apps(cfg)
        self.assertEqual(set(data["hero"][0]), {"id", "appId", "title", "subtitle", "backdrop", "kind"})
        item = data["rows"][0]["items"][0]
        self.assertEqual(set(item), {"id", "name", "subtitle", "icon", "color", "kind"})
        self.assertEqual(item["icon"], "/media/sleeper/icon")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "icon.png").write_bytes(b"\x89PNG fake")
        (self.dir / "secret.txt").write_text("do not serve")
        ui = self.dir / "ui"
        ui.mkdir()
        (ui / "index.html").write_text('<html><head><meta name="xlab-token" content="" /></head><body>ui</body></html>')
        (ui / "app.js").write_text("console.log(1)")
        self.library = server.Library(write_config(self.dir, BASE), detect=lambda: {})
        self.launcher = server.Launcher(self.library)
        self.power_calls = []
        port_ref = [0]
        import apps
        self.store_run = []

        def store_run(cmd, **kw):
            import subprocess
            self.store_run.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        self.store = apps.Store(apps.load_catalog(), self.dir / "icons", run=store_run, fetch=lambda u: b"")
        self.forgot = []
        test = self

        class FakeRemote:
            def info(self):
                return {"code": "123456", "url": "http://192.168.1.5:8766/remote"}

            def forget(self):
                test.forgot.append(True)
        handler = server.make_handler(self.library, self.launcher, ui, TOKEN, port_ref,
                                      run=lambda cmd, **kw: self.power_calls.append(cmd), store=self.store,
                                      remote=FakeRemote())
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        port_ref[0] = self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for proc in self.launcher._procs.values():
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        self.tmp.cleanup()

    def request(self, method, path, body=None, token=TOKEN, host=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or f"127.0.0.1:{self.port}"}
        if token:
            h["X-XLab-Token"] = token
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        conn.request(method, path, body=data, headers=h)
        resp = conn.getresponse()
        out = resp.status, resp.read()
        conn.close()
        return out

    def test_index_gets_token(self):
        status, body = self.request("GET", "/", token=None)
        self.assertEqual(status, 200)
        self.assertIn(b'<meta name="xlab-token" content="test-token">', body)
        self.assertEqual(body.count(b"xlab-token"), 1)

    def test_static_file_and_spa_fallback(self):
        self.assertEqual(self.request("GET", "/app.js")[1], b"console.log(1)")
        self.assertIn(b"xlab-token", self.request("GET", "/some/route")[1])

    def test_path_traversal_is_blocked(self):
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"):
            self.assertNotIn(b"do not serve", self.request("GET", path)[1], path)

    def test_wrong_host_is_rejected(self):
        self.assertEqual(self.request("GET", "/api/apps", host="evil.example:80")[0], 403)

    def test_foreign_origin_is_rejected(self):
        status, _ = self.request("POST", "/api/launch", {"id": "sleeper"},
                                 headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)

    def test_api_needs_token(self):
        self.assertEqual(self.request("GET", "/api/apps", token="wrong")[0], 401)
        self.assertEqual(self.request("POST", "/api/launch", {"id": "sleeper"}, token=None)[0], 401)

    def test_media_serves_only_configured_files(self):
        self.assertEqual(self.request("GET", "/media/sleeper/icon")[1], b"\x89PNG fake")
        self.assertEqual(self.request("GET", "/media/sleeper/secret")[0], 404)

    def test_launch_status_and_several_apps(self):
        clock = [100.0]
        self.launcher.clock = lambda: clock[0]
        status, body = self.request("POST", "/api/launch", {"id": "sleeper"})
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        self.assertEqual(json.loads(self.request("GET", "/api/status")[1]),
                         {"running": "sleeper", "open": ["sleeper"]})
        clock[0] += server.OPENING_SECONDS + 1   # "Opening…" is only for the first seconds
        self.assertEqual(json.loads(self.request("GET", "/api/status")[1]),
                         {"running": None, "open": ["sleeper"]})
        first = self.launcher._procs["sleeper"]
        # opening it again is fine: it is brought forward, not refused
        self.assertEqual(self.request("POST", "/api/launch", {"id": "sleeper"})[0], 200)
        self.assertIs(self.launcher._procs["sleeper"], first)
        first.kill()
        first.wait()
        self.assertEqual(json.loads(self.request("GET", "/api/status")[1])["open"], [])

    def test_launch_errors(self):
        self.assertEqual(self.request("POST", "/api/launch", {"id": "nope"})[0], 404)
        status, body = self.request("POST", "/api/launch", {"id": "missing"})
        self.assertEqual(status, 409)
        self.assertIn("could not start", json.loads(body)["error"])

    def test_power_whitelist(self):
        self.assertEqual(self.request("POST", "/api/power", {"action": "reboot"})[0], 200)
        self.assertEqual(self.power_calls, [["systemctl", "reboot"]])
        self.assertEqual(self.request("POST", "/api/power", {"action": "rm"})[0], 400)

    def test_store_list_and_install(self):
        status, body = self.request("GET", "/api/store")
        items = {i["id"]: i for i in json.loads(body)["items"]}
        self.assertEqual(status, 200)
        self.assertFalse(items["youtube"]["installed"])
        self.assertEqual(self.request("POST", "/api/store", {"id": "youtube", "action": "install"})[0], 202)
        for _ in range(100):
            if self.store.jobs["youtube"]["state"] == "done":
                break
            time.sleep(0.02)
        self.assertEqual(self.store_run[-1][-1], "rocks.shy.VacuumTube")
        self.assertEqual(self.request("POST", "/api/store", {"id": "nope", "action": "install"})[0], 404)
        self.assertEqual(self.request("POST", "/api/store", {"id": "kodi"}, token=None)[0], 401)

    def test_remote_pairing_info(self):
        status, body = self.request("GET", "/api/remote")
        self.assertEqual((status, json.loads(body)["code"]), (200, "123456"))
        self.assertEqual(self.request("GET", "/api/remote", token=None)[0], 401)
        self.assertEqual(self.request("POST", "/api/remote", {"action": "forget"})[0], 200)
        self.assertEqual(self.forgot, [True])

    def test_close_endpoint(self):
        self.assertEqual(self.request("POST", "/api/close", {"id": "sleeper"})[0], 404)
        self.request("POST", "/api/launch", {"id": "sleeper"})
        self.assertEqual(self.request("POST", "/api/close", {"id": "sleeper"})[0], 200)
        self.assertEqual(self.launcher.open_apps(), [])

    def test_stop_closes_the_most_recent_app(self):
        self.assertFalse(self.launcher.stop())
        self.request("POST", "/api/launch", {"id": "sleeper"})
        self.assertEqual(self.launcher.front(), "sleeper")
        self.assertTrue(self.launcher.stop())
        self.assertIsNone(self.launcher.front())
        self.assertEqual(self.launcher.open_apps(), [])

    def test_bad_body(self):
        status, _ = self.request("POST", "/api/launch", None, headers={"Content-Length": "0"})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()


class MultiAppTests(unittest.TestCase):
    def test_two_apps_and_a_preview(self):
        sleep = [sys.executable, "-c", "import time; time.sleep(30)"]
        quick = [sys.executable, "-c", "pass"]

        class Lib:
            def get(self):
                return {"apps": {
                    "a": {"name": "A", "command": sleep},
                    "b": {"name": "B", "command": sleep},
                    "cw-1": {"name": "Film", "command": quick, "parent": "b"},
                }}
        launcher = server.Launcher(Lib())
        try:
            launcher.launch("a")
            launcher.launch("b")
            self.assertEqual(launcher.open_apps(), ["a", "b"])
            launcher.launch("a")                     # back to A: it becomes the front app
            self.assertEqual(launcher.front(), "a")
            launcher.launch("cw-1")                  # a preview counts as its app, B
            self.assertEqual(launcher.open_apps(), ["a", "b"])
            self.assertEqual(launcher.status(), "cw-1")
            self.assertTrue(launcher.stop())         # Home closes the most recent: B
            self.assertEqual(launcher.open_apps(), ["a"])
        finally:
            for p in launcher._procs.values():
                p.kill()
                p.wait()


class ShowLauncherTests(unittest.TestCase):
    def test_gdbus_answer(self):
        import subprocess
        ok = lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, "(true,)\n", "")
        missing = lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "No such interface")
        def no_gdbus(cmd, **kw):
            raise FileNotFoundError("gdbus")
        self.assertTrue(server.show_launcher(ok))
        self.assertFalse(server.show_launcher(missing))
        self.assertFalse(server.show_launcher(no_gdbus))
