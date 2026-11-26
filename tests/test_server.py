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
        self.assertEqual(cfg["hero"], ["nuvio"])

    def test_unknown_app_in_row_is_rejected(self):
        bad = dict(BASE, rows=[{"title": "x", "apps": ["nope"]}])
        with self.assertRaises(server.ConfigError):
            server.load_config(write_config(self.dir, bad))

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
        self.assertEqual(set(data["hero"][0]), {"id", "appId", "title", "subtitle", "backdrop"})
        item = data["rows"][0]["items"][0]
        self.assertEqual(set(item), {"id", "name", "subtitle", "icon", "color"})
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
        self.config = server.load_config(write_config(self.dir, BASE))
        self.launcher = server.Launcher(self.config)
        self.power_calls = []
        port_ref = [0]
        handler = server.make_handler(self.config, self.launcher, ui, TOKEN, port_ref,
                                      run=lambda cmd, **kw: self.power_calls.append(cmd))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        port_ref[0] = self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        proc = self.launcher._proc
        if proc and proc.poll() is None:
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

    def test_launch_status_and_double_launch(self):
        status, body = self.request("POST", "/api/launch", {"id": "sleeper"})
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        self.assertEqual(json.loads(self.request("GET", "/api/status")[1]), {"running": "sleeper"})
        status, body = self.request("POST", "/api/launch", {"id": "sleeper"})
        self.assertEqual(status, 409)
        self.launcher._proc.kill()
        self.launcher._proc.wait()
        time.sleep(0.05)
        self.assertEqual(json.loads(self.request("GET", "/api/status")[1]), {"running": None})

    def test_launch_errors(self):
        self.assertEqual(self.request("POST", "/api/launch", {"id": "nope"})[0], 404)
        status, body = self.request("POST", "/api/launch", {"id": "missing"})
        self.assertEqual(status, 409)
        self.assertIn("could not start", json.loads(body)["error"])

    def test_power_whitelist(self):
        self.assertEqual(self.request("POST", "/api/power", {"action": "reboot"})[0], 200)
        self.assertEqual(self.power_calls, [["systemctl", "reboot"]])
        self.assertEqual(self.request("POST", "/api/power", {"action": "rm"})[0], 400)

    def test_bad_body(self):
        status, _ = self.request("POST", "/api/launch", None, headers={"Content-Length": "0"})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
