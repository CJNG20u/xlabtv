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
            self.assertTrue(entry.get("flatpak") or entry.get("web") or entry.get("install"), app_id)

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
