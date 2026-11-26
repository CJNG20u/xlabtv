"""Latest videos from the YouTube channels listed in apps.json, for the hero previews.

Uses YouTube's public channel feeds (no account, no API key):
    https://www.youtube.com/feeds/videos.xml?channel_id=UC...
Channels can be given as ids (UC...) or @handles; handles are looked up once and cached.
Feeds are fetched in the background so the launcher never waits on the network.
"""
from __future__ import annotations

import calendar
import json
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote

FEED = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}
CHANNEL_ID = re.compile(r"^UC[\w-]{22}$")
VIDEO_ID = re.compile(r"^[\w-]{11}$")


def fetch_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (xlab-tv)",
                                               "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read(3_000_000)


def resolve_channel(name: str, fetch=fetch_url) -> str | None:
    """A channel id for 'UC…', '@handle' or a channel URL."""
    name = name.strip().rstrip("/")
    if CHANNEL_ID.match(name):
        return name
    m = re.search(r"/channel/(UC[\w-]{22})", name)
    if m:
        return m.group(1)
    handle = name.rsplit("/", 1)[-1]
    if not handle.startswith("@"):
        handle = "@" + handle
    page = fetch(f"https://www.youtube.com/{quote(handle)}").decode("utf-8", "replace")
    m = (re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', page)
         or re.search(r'"(?:externalId|channelId)":"(UC[\w-]{22})"', page))
    return m.group(1) if m else None


def parse_feed(xml: bytes) -> list[dict]:
    root = ET.fromstring(xml)
    author = root.findtext("a:author/a:name", default="", namespaces=NS) or root.findtext(
        "a:title", default="", namespaces=NS)
    videos = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        if not VIDEO_ID.match(vid):
            continue
        if "/shorts/" in (e.find("a:link", NS).get("href", "") if e.find("a:link", NS) is not None else ""):
            continue  # Shorts are vertical: they make poor TV heroes
        videos.append({
            "videoId": vid,
            "title": e.findtext("a:title", default="", namespaces=NS),
            "channel": author,
            "published": e.findtext("a:published", default="", namespaces=NS),
        })
    return videos


def _ago(published: str, now: float) -> str:
    try:
        t = calendar.timegm(time.strptime(published[:19], "%Y-%m-%dT%H:%M:%S"))  # feeds are in UTC
    except ValueError:
        return ""
    hours = max(0, int((now - t) // 3600))
    if hours < 1:
        return "just now"
    if hours < 24:
        return f"{hours} h ago"
    days = hours // 24
    return "yesterday" if days == 1 else f"{days} days ago"


def previews(videos: list[dict], limit: int = 10, now: float | None = None) -> list[dict]:
    now = now or time.time()
    videos = sorted(videos, key=lambda v: v["published"], reverse=True)[:limit]
    return [{
        "videoId": v["videoId"],
        "title": v["title"],
        "subtitle": " · ".join(x for x in (v["channel"], _ago(v["published"], now)) if x),
        "backdrop": f"https://i.ytimg.com/vi/{v['videoId']}/maxresdefault.jpg",
        "backdropFallback": f"https://i.ytimg.com/vi/{v['videoId']}/hqdefault.jpg",
        "url": f"https://www.youtube.com/watch?v={v['videoId']}",
    } for v in videos]


class YouTubeFeeds:
    """Keeps the latest videos of the configured channels, refreshed every 30 minutes."""

    def __init__(self, cache_dir: Path, fetch=fetch_url, every: float = 1800):
        self.cache = cache_dir / "youtube-channels.json"
        self.fetch, self.every = fetch, every
        self._lock = threading.Lock()
        self._channels: tuple[str, ...] = ()
        self._videos: list[dict] = []
        self._at = 0.0
        self._busy = False
        try:
            self._ids = json.loads(self.cache.read_text())
        except (OSError, ValueError):
            self._ids = {}

    def get(self, channels: list[str]) -> list[dict]:
        """Previews for these channels now; starts a refresh in the background when due."""
        key = tuple(channels)
        with self._lock:
            due = key != self._channels or time.monotonic() - self._at > self.every
            if due and not self._busy and key:
                self._busy = True
                threading.Thread(target=self._refresh, args=(key,), daemon=True).start()
            return previews(self._videos) if key == self._channels else []

    def refresh_now(self, channels: list[str]) -> list[dict]:
        self._refresh(tuple(channels))
        return previews(self._videos)

    def _refresh(self, channels: tuple[str, ...]):
        videos = []
        try:
            for name in channels:
                try:
                    cid = self._ids.get(name) or resolve_channel(name, self.fetch)
                    if not cid:
                        continue
                    self._ids[name] = cid
                    videos += parse_feed(self.fetch(FEED.format(cid)))
                except Exception:  # one bad channel or a network blip: skip it
                    continue
            try:
                self.cache.parent.mkdir(parents=True, exist_ok=True)
                self.cache.write_text(json.dumps(self._ids))
            except OSError:
                pass
            with self._lock:
                if videos or channels != self._channels:
                    self._videos = videos
                self._channels = channels
                self._at = time.monotonic()
        finally:
            with self._lock:
                self._busy = False
