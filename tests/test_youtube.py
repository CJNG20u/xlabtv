import calendar
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import server  # noqa: E402
import youtube  # noqa: E402

FEED_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
 <title>Some Channel</title>
 <author><name>Some Channel</name></author>
 <entry>
  <yt:videoId>AAAAAAAAAAA</yt:videoId><title>Older video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
  <published>2026-11-20T10:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>BBBBBBBBBBB</yt:videoId><title>New video &amp; more</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=BBBBBBBBBBB"/>
  <published>2026-11-25T10:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>CCCCCCCCCCC</yt:videoId><title>A short</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/CCCCCCCCCCC"/>
  <published>2026-11-25T11:00:00+00:00</published>
 </entry>
</feed>"""
CID = "UC" + "x" * 22


class YouTubeTests(unittest.TestCase):
    def test_parse_feed_skips_shorts(self):
        videos = youtube.parse_feed(FEED_XML)
        self.assertEqual([v["videoId"] for v in videos], ["AAAAAAAAAAA", "BBBBBBBBBBB"])
        self.assertEqual(videos[1]["title"], "New video & more")
        self.assertEqual(videos[1]["channel"], "Some Channel")

    def test_previews_newest_first(self):
        now = calendar.timegm((2026, 11, 25, 13, 0, 0, 0, 0, 0))  # 3 h after the newest video
        p = youtube.previews(youtube.parse_feed(FEED_XML), now=now)
        self.assertEqual(p[0]["videoId"], "BBBBBBBBBBB")
        self.assertEqual(p[0]["subtitle"], "Some Channel · 3 h ago")
        self.assertEqual(p[0]["backdrop"], "https://i.ytimg.com/vi/BBBBBBBBBBB/maxresdefault.jpg")
        self.assertEqual(p[0]["url"], "https://www.youtube.com/watch?v=BBBBBBBBBBB")

    def test_resolve_channel(self):
        self.assertEqual(youtube.resolve_channel(CID), CID)
        self.assertEqual(youtube.resolve_channel(f"https://www.youtube.com/channel/{CID}"), CID)
        page = f'<link rel="canonical" href="https://www.youtube.com/channel/{CID}">'.encode()
        asked = []

        def fetch(url):
            asked.append(url)
            return page
        self.assertEqual(youtube.resolve_channel("@someone", fetch), CID)
        self.assertEqual(youtube.resolve_channel("https://www.youtube.com/@someone", fetch), CID)
        self.assertEqual(asked, ["https://www.youtube.com/%40someone"] * 2)

    def test_feeds_cache_handles_and_survive_failures(self):
        page = f'"channelId":"{CID}"'.encode()

        def fetch(url):
            if "feeds" in url:
                return FEED_XML
            if "broken" in url:
                raise OSError("offline")
            return page
        with tempfile.TemporaryDirectory() as tmp:
            feeds = youtube.YouTubeFeeds(Path(tmp), fetch)
            got = feeds.refresh_now(["@someone", "@broken"])
            self.assertEqual(len(got), 2)
            self.assertIn("@someone", youtube.YouTubeFeeds(Path(tmp), fetch)._ids)  # cached

    def test_youtube_previews_open_the_video_in_vacuumtube(self):
        detected = {"youtube": {"name": "YouTube", "subtitle": "", "color": "#f00", "row": "Watch",
                                "command": ["flatpak", "run", "rocks.shy.VacuumTube"], "media": {}}}
        videos = youtube.previews(youtube.parse_feed(FEED_XML))
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "apps.json").write_text('{"youtube": {"channels": ["@someone"]}}')
            lib = server.Library(Path(tmp) / "apps.json", detect=lambda: detected,
                                 continue_watching=lambda: [], youtube=lambda ch: videos)
            cfg = lib.get()
        pid = cfg["apps"]["youtube"]["previews"][0]
        self.assertEqual(cfg["apps"][pid]["command"],
                         ["flatpak", "run", "rocks.shy.VacuumTube",
                          "https://www.youtube.com/watch?v=BBBBBBBBBBB", "--fullscreen"])
        card = server.api_apps(cfg)["rows"][0]["items"][0]
        self.assertEqual(card["previews"][0]["eyebrow"], "New on YouTube")
        self.assertEqual(card["previews"][0]["backdropFallback"],
                         "https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg")
        self.assertEqual([r["title"] for r in cfg["rows"]], ["Watch"])  # previews are not a row

    def test_bad_channels_setting(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "apps.json").write_text('{"youtube": {"channels": "@one"}}')
            with self.assertRaises(server.ConfigError):
                server.load_config(Path(tmp) / "apps.json")


if __name__ == "__main__":
    unittest.main()
