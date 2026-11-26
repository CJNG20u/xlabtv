import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import nuvio  # noqa: E402
import server  # noqa: E402


def java_escape(s: str) -> str:
    """What java.util.Properties.store writes for a value."""
    out = []
    for c in s:
        if c in "\\":
            out.append("\\\\")
        elif c in "=:#!":
            out.append("\\" + c)
        elif c == "\n":
            out.append("\\n")
        elif ord(c) > 126:
            out.append("\\u%04X" % ord(c))
        else:
            out.append(c)
    return "".join(out)


def entry(meta, title, pos, dur, updated, season=None, episode=None, **kw):
    e = {"contentType": "series" if season else "movie", "parentMetaId": meta,
         "parentMetaType": "series" if season else "movie", "videoId": meta, "title": title,
         "lastPositionMs": pos, "durationMs": dur, "lastUpdatedEpochMs": updated,
         "background": f"https://img.example/{meta}.jpg"}
    if season:
        e.update(seasonNumber=season, episodeNumber=episode, episodeTitle="Pilot")
    e.update(kw)
    return e


def write_store(folder: Path, entries, profile=1):
    folder.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"entries": entries, "lastSuccessfulPushEpochMs": 0})
    (folder / "nuvio_watch_progress.properties").write_text(
        "#Wed Nov 25 21:00:00 EST 2026\n" + f"watch_progress_{profile}={java_escape(payload)}\n")


class PropertiesTests(unittest.TestCase):
    def test_java_escapes_and_continuations(self):
        text = ("# comment\n! also\nkey1=a\\:b\\=c\nkey\\ two : spaced value\n"
                "long=one \\\n    two\nuni=caf\\u00E9\n")
        props = nuvio.parse_properties(text)
        self.assertEqual(props["key1"], "a:b=c")
        self.assertEqual(props["key two"], "spaced value")
        self.assertEqual(props["long"], "one two")
        self.assertEqual(props["uni"], "café")

    def test_round_trips_json_written_by_java(self):
        payload = json.dumps({"entries": [{"title": "Café: Part #1!", "a": "x=y"}]})
        props = nuvio.parse_properties(f"watch_progress_1={java_escape(payload)}\n")
        self.assertEqual(json.loads(props["watch_progress_1"])["entries"][0]["title"], "Café: Part #1!")


class ContinueWatchingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_flatpak_store_newest_first_one_per_show(self):
        acct = self.home / ".var/app/com.nuvio.media.desktop/config/nuviohtpc/accounts/a1"
        write_store(acct, [
            entry("tt1", "Old film", 30 * 60000, 100 * 60000, 1000),
            entry("tt2", "Show", 10 * 60000, 40 * 60000, 3000, season=1, episode=2),
            entry("tt2", "Show", 20 * 60000, 40 * 60000, 2000, season=1, episode=1),  # older episode
            entry("tt3", "Barely started", 1000, 100 * 60000, 4000),
            entry("tt4", "Finished", 99 * 60000, 100 * 60000, 5000),
            entry("tt5", "Marked done", 10 * 60000, 100 * 60000, 6000, isCompleted=True),
        ])
        items = nuvio.continue_watching(self.home)
        self.assertEqual([i["metaId"] for i in items], ["tt2", "tt1"])
        self.assertEqual(items[0]["subtitle"], "S1:E2 · Pilot · 30 min left")
        self.assertEqual(items[0]["type"], "series")
        self.assertAlmostEqual(items[1]["progress"], 0.3)
        self.assertEqual(nuvio.deep_link(items[0]), "nuvio://meta?type=series&id=tt2")

    def test_nothing_there(self):
        self.assertEqual(nuvio.continue_watching(self.home), [])

    def test_broken_store_is_skipped(self):
        d = self.home / ".config/nuviohtpc/accounts/x"
        d.mkdir(parents=True)
        (d / "nuvio_watch_progress.properties").write_text("watch_progress_1={not json\n")
        self.assertEqual(nuvio.continue_watching(self.home), [])


class LauncherIntegrationTests(unittest.TestCase):
    def test_row_hero_and_launch_command(self):
        detected = {"nuvio": {"name": "Nuvio", "subtitle": "", "color": "#7c3aed", "row": "Watch",
                              "command": ["flatpak", "run", "com.nuvio.media.desktop"], "media": {}}}
        items = [{"type": "movie", "metaId": "tt9", "title": "Dune", "subtitle": "40 min left", "progress": 0.5,
                  "backdrop": "https://b", "poster": "https://p", "thumbnail": "", "logo": "https://l"}]
        with tempfile.TemporaryDirectory() as tmp:
            library = server.Library(Path(tmp) / "none.json", detect=lambda: detected,
                                     continue_watching=lambda: items)
            cfg = library.get()
        first_row = cfg["rows"][0]
        self.assertEqual(first_row["title"], "Continue watching")
        cw_id = first_row["apps"][0]
        self.assertEqual(cfg["hero"][0], cw_id)
        self.assertEqual(cfg["apps"][cw_id]["command"][-1], "nuvio://meta?type=movie&id=tt9")
        api = server.api_apps(cfg)
        self.assertEqual(api["hero"][0]["backdrop"], "https://b")
        self.assertEqual(api["hero"][0]["kind"], "media")
        card = api["rows"][0]["items"][0]
        self.assertEqual((card["kind"], card["progress"], card["backdrop"]), ("media", 0.5, "https://b"))

    def test_without_nuvio_nothing_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = server.Library(Path(tmp) / "none.json", detect=lambda: {},
                                      continue_watching=lambda: 1 / 0)
            self.assertEqual(library.get()["rows"], [])

    def test_reader_errors_do_not_break_the_launcher(self):
        detected = {"nuvio": {"name": "Nuvio", "subtitle": "", "color": "#000", "row": "Watch",
                              "command": ["nuvio-desktop"], "media": {}}}
        with tempfile.TemporaryDirectory() as tmp:
            library = server.Library(Path(tmp) / "none.json", detect=lambda: detected,
                                     continue_watching=lambda: 1 / 0)
            self.assertEqual([r["title"] for r in library.get()["rows"]], ["Watch"])


if __name__ == "__main__":
    unittest.main()
