import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import apps  # noqa: E402

CATALOG = apps.load_catalog()


def which_none(_name):
    return None


class CatalogTests(unittest.TestCase):
    def test_catalog_is_consistent(self):
        rows = set(CATALOG["rows"])
        for app_id, entry in CATALOG["apps"].items():
            self.assertIn(entry["row"], rows, app_id)
            self.assertTrue(entry.get("flatpak") or entry.get("web") or entry.get("terminal"), app_id)

    def test_nothing_installed(self):
        self.assertEqual(apps.detect(CATALOG, set(), which_none), {})

    def test_flatpak_and_binary_detection(self):
        found = apps.detect(CATALOG, {"rocks.shy.VacuumTube", "com.valvesoftware.Steam"},
                            lambda b: "/usr/bin/kodi" if b == "kodi" else None)
        self.assertEqual(list(found), ["kodi", "youtube", "steam"])  # catalog order
        self.assertEqual(found["kodi"]["command"], ["kodi"])
        self.assertEqual(found["youtube"]["command"], ["flatpak", "run", "rocks.shy.VacuumTube"])
        self.assertEqual(found["steam"]["command"], ["flatpak", "run", "com.valvesoftware.Steam", "-gamepadui"])

    def test_binary_wins_over_flatpak(self):
        found = apps.detect(CATALOG, {"com.nuvio.media.desktop"},
                            lambda b: "/usr/bin/nuvio-desktop" if b == "nuvio-desktop" else None)
        self.assertEqual(found["nuvio"]["command"], ["nuvio-desktop"])

    def test_web_apps_need_chrome(self):
        self.assertNotIn("netflix", apps.detect(CATALOG, set(), which_none))
        found = apps.detect(CATALOG, {"com.google.Chrome"}, which_none)
        self.assertEqual(found["netflix"]["command"],
                         ["flatpak", "run", "com.google.Chrome", "--start-fullscreen",
                          "--app=https://www.netflix.com/browse"])

    def test_terminal_tools_use_the_first_terminal_found(self):
        found = apps.detect(CATALOG, set(), lambda b: "/usr/bin/" + b if b in ("ptyxis", "xterm") else None)
        self.assertEqual(found["terminal"]["command"], ["ptyxis", "--standalone", "--maximize"])
        self.assertEqual(found["updates"]["command"],
                         ["ptyxis", "--maximize", "--", "/usr/local/bin/xlab-tv-update"])
        self.assertEqual(found["terminal"]["row"], "System")
        self.assertNotIn("terminal", apps.detect(CATALOG, set(), which_none))

    def test_store_leaves_out_built_in_tools(self):
        store = apps.Store(CATALOG, Path(tempfile.mkdtemp()), run=lambda *a, **k: None, fetch=lambda u: b"")
        self.assertNotIn("updates", [i["id"] for i in store.items({})])

    def test_icons_from_flatpak_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            d = home / ".local/share/flatpak/exports/share/icons/hicolor/128x128/apps"
            d.mkdir(parents=True)
            (d / "rocks.shy.VacuumTube.png").write_bytes(b"png")
            found = apps.detect(CATALOG, {"rocks.shy.VacuumTube"}, which_none, home=home)
            self.assertEqual(found["youtube"]["media"]["icon"], d / "rocks.shy.VacuumTube.png")

    def test_flatpak_list_failure_is_empty(self):
        def boom(*a, **k):
            raise OSError("no flatpak")
        self.assertEqual(apps.installed_flatpaks(run=boom), set())


if __name__ == "__main__":
    unittest.main()


class FakeRun:
    def __init__(self, fail_on=None, user_apps=""):
        self.calls, self.fail_on, self.user_apps = [], fail_on, user_apps

    def __call__(self, cmd, **kw):
        import subprocess
        self.calls.append(cmd)
        if cmd[:3] == ["flatpak", "list", "--user"]:
            return subprocess.CompletedProcess(cmd, 0, self.user_apps, "")
        if self.fail_on and self.fail_on in cmd:
            return subprocess.CompletedProcess(cmd, 1, "", "error: No remote refs found for 'x'\n")
        return subprocess.CompletedProcess(cmd, 0, "", "")


def wait_job(store, app_id):
    import time
    for _ in range(100):
        if store.jobs[app_id]["state"] in ("done", "failed"):
            return store.jobs[app_id]
        time.sleep(0.02)
    raise AssertionError("job did not finish")


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name)
        self.changed = 0

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, run, fetch=lambda url: b""):
        def bump():
            self.changed += 1
        return apps.Store(CATALOG, self.cache, on_change=bump, run=run, fetch=fetch)

    def test_install_commands(self):
        self.assertEqual(apps.install_commands(CATALOG, "youtube")[-1],
                         ["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", "rocks.shy.VacuumTube"])
        nuvio = apps.install_commands(CATALOG, "nuvio")
        self.assertEqual(nuvio[1][:5], ["flatpak", "remote-add", "--user", "--if-not-exists", "nuvio"])
        self.assertEqual(nuvio[-1][-2:], ["nuvio", "com.nuvio.media.desktop"])
        self.assertEqual(apps.install_commands(CATALOG, "netflix")[-1][-1], "com.google.Chrome")

    def test_install_job(self):
        run = FakeRun()
        store = self.make(run)
        store.request("youtube", "install")
        job = wait_job(store, "youtube")
        self.assertEqual(job["state"], "done")
        self.assertEqual(run.calls[-1][-1], "rocks.shy.VacuumTube")
        self.assertEqual(self.changed, 1)

    def test_failed_install_reports_flatpak_error(self):
        store = self.make(FakeRun(fail_on="install"))
        store.request("kodi", "install")
        job = wait_job(store, "kodi")
        self.assertEqual(job["state"], "failed")
        self.assertIn("No remote refs", job["message"])

    def test_remove_only_user_installs(self):
        store = self.make(FakeRun(user_apps="tv.kodi.Kodi\n"))
        store.request("kodi", "remove")
        self.assertEqual(wait_job(store, "kodi")["state"], "done")
        store.request("spotify", "remove")
        job = wait_job(store, "spotify")
        self.assertEqual(job["state"], "failed")
        self.assertIn("outside xLab TV", job["message"])

    def test_bad_requests(self):
        store = self.make(FakeRun())
        with self.assertRaises(KeyError):
            store.request("nope", "install")
        with self.assertRaises(ValueError):
            store.request("kodi", "explode")

    def test_items_and_icon_fetch(self):
        def fetch(url):
            if "appstream" in url:
                return b'{"icon": "https://dl.flathub.org/media/icon.png"}'
            return b"PNGDATA"
        store = self.make(FakeRun(), fetch)
        items = {i["id"]: i for i in store.items({"kodi": {"media": {}}})}
        self.assertTrue(items["kodi"]["installed"])
        self.assertFalse(items["spotify"]["installed"])
        self.assertEqual(items["spotify"]["category"], "Music")
        import time
        for _ in range(100):
            if store.icon_path("spotify"):
                break
            time.sleep(0.02)
        self.assertEqual(store.icon_path("spotify").read_bytes(), b"PNGDATA")
        self.assertIsNone(store.icon_path("netflix"))  # web apps have no Flathub icon
