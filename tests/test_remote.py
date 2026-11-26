import http.client
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import remote  # noqa: E402
import server  # noqa: E402


class FakeBackend:
    def __init__(self):
        self.events = []

    def tap(self, key, shift=False):
        self.events.append(("tap", key, shift))

    def move(self, dx, dy):
        self.events.append(("move", dx, dy))

    def click(self, button):
        self.events.append(("click", button))

    def scroll(self, dy):
        self.events.append(("scroll", dy))


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Path(self.tmp.name) / "remotes.json"
        self.clock = Clock()

    def tearDown(self):
        self.tmp.cleanup()

    def test_pair_once_and_persist(self):
        p = remote.Pairing(self.store, self.clock)
        code, left = p.code()
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(left, remote.CODE_TTL)
        token = p.pair(code, "Pixel")
        self.assertTrue(token and p.check(token))
        self.assertIsNone(p.pair(code, "Second phone"))  # a code pairs one phone
        self.assertTrue(remote.Pairing(self.store, self.clock).check(token))  # kept on disk
        self.assertFalse(p.check("") or p.check("nope"))

    def test_wrong_guesses_and_expiry(self):
        p = remote.Pairing(self.store, self.clock)
        code, _ = p.code()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(remote.CODE_TRIES):
            self.assertIsNone(p.pair(wrong, "x"))
        self.assertIsNone(p.pair(code, "x"))  # locked after 5 wrong tries
        code2, _ = p.code()                   # the TV shows a fresh one
        self.clock.t += remote.CODE_TTL + 1
        self.assertIsNone(p.pair(code2, "x"))  # expired

    def test_forget_all(self):
        p = remote.Pairing(self.store, self.clock)
        token = p.pair(p.code()[0], "x")
        p.forget_all()
        self.assertFalse(p.check(token))


class InputTests(unittest.TestCase):
    def test_keys_text_and_mouse(self):
        fake = FakeBackend()
        vi = remote.VirtualInput(lambda: fake)
        vi.key("back")
        self.assertEqual(vi.text("Hi 5!é"), 5)  # é is skipped
        vi.move(9999, -3)
        vi.click("left")
        self.assertEqual(fake.events[0], ("tap", "KEY_ESC", False))
        self.assertEqual(fake.events[1], ("tap", "KEY_H", True))
        self.assertEqual(fake.events[5], ("tap", "KEY_1", True))  # "!"
        self.assertIn(("move", 500, -3), fake.events)
        with self.assertRaises(KeyError):
            vi.key("selfdestruct")

    def test_unavailable_input_reports_why(self):
        def broken():
            raise PermissionError("/dev/uinput: permission denied")
        vi = remote.VirtualInput(broken)
        vi.warm()
        self.assertIn("permission denied", vi.error)
        with self.assertRaises(RuntimeError):
            vi.key("ok")

    def test_every_remote_key_maps_to_a_linux_key(self):
        for name, key in remote.KEYS.items():
            self.assertTrue(key.startswith("KEY_"), name)
        for ch in "azAZ09 -=[];',./`!@#$%^&*()_+{}|:\"<>?~\n":
            self.assertIsNotNone(remote.char_key(ch), ch)


class FakeLauncher:
    def __init__(self):
        self.stopped = 0
        self.launched = []

    def status(self):
        return None

    def stop(self):
        self.stopped += 1
        return True

    def launch(self, app_id):
        if app_id != "kodi":
            raise KeyError(app_id)
        self.launched.append(app_id)


class RemoteServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "apps.json").write_text(json.dumps({"apps": {"kodi": {"name": "Kodi", "command": ["kodi"]}}}))
        self.library = server.Library(d / "apps.json", detect=lambda: {})
        self.pairing = remote.Pairing(d / "remotes.json")
        self.fake = FakeBackend()
        self.launcher = FakeLauncher()
        self.power = []
        page = Path(__file__).resolve().parents[1] / "xlabtv" / "remote.html"
        handler = remote.make_remote_handler(self.pairing, remote.VirtualInput(lambda: self.fake), self.library,
                                             self.launcher, page, None, self.power.append)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Remote-Token"] = token
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def paired_token(self):
        status, data = self.call("POST", "/remote/pair", {"code": self.pairing.code()[0], "name": "Pixel"})
        self.assertEqual(status, 200)
        return data["token"]

    def test_page_has_no_launcher_token(self):
        status, body = self.call("GET", "/remote")
        self.assertEqual(status, 200)
        self.assertIn(b"xLab TV Remote", body)
        self.assertNotIn(b"xlab-token", body)

    def test_everything_needs_pairing(self):
        self.assertEqual(self.call("POST", "/remote/key", {"key": "ok"})[0], 401)
        self.assertEqual(self.call("GET", "/remote/apps")[0], 401)
        self.assertEqual(self.call("POST", "/remote/pair", {"code": "nope"})[0], 403)
        self.assertEqual(self.fake.events, [])

    def test_remote_controls(self):
        t = self.paired_token()
        self.assertEqual(self.call("POST", "/remote/key", {"key": "back"}, t)[0], 200)
        self.assertEqual(self.fake.events[-1], ("tap", "KEY_ESC", False))
        self.call("POST", "/remote/key", {"key": "home"}, t)
        self.assertEqual(self.launcher.stopped, 1)
        self.call("POST", "/remote/text", {"text": "ok"}, t)
        self.call("POST", "/remote/mouse", {"dx": 4, "dy": -2}, t)
        self.call("POST", "/remote/mouse", {"click": "right"}, t)
        self.assertEqual(self.fake.events[-2:], [("move", 4, -2), ("click", "right")])
        self.assertEqual(self.call("POST", "/remote/launch", {"id": "kodi"}, t)[0], 200)
        self.assertEqual(self.call("POST", "/remote/launch", {"id": "nope"}, t)[0], 404)
        self.assertEqual(self.call("POST", "/remote/key", {"key": "nope"}, t)[0], 404)
        status, data = self.call("GET", "/remote/apps", token=t)
        self.assertEqual([a["id"] for a in data["apps"]], ["kodi"])
        self.assertEqual(self.call("POST", "/remote/power", {"action": "suspend"}, t)[0], 200)
        self.assertEqual(self.power, ["suspend"])


if __name__ == "__main__":
    unittest.main()
