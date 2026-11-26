"""Continue watching from Nuvio: reads Nuvio's own watch progress (read-only).

Nuvio Desktop keeps it as Java .properties files, one folder per account:
    <config>/nuviohtpc/accounts/<slot>/nuvio_watch_progress.properties
with keys watch_progress_<profile> holding JSON {"entries": [...]}. <config> is
~/.config for the .deb and ~/.var/app/com.nuvio.media.desktop/config for the Flatpak.
Opening an item uses Nuvio's deep link nuvio://meta?type=...&id=..., which opens
the title in Nuvio (or in the Nuvio window already open).
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

FLATPAK_ID = "com.nuvio.media.desktop"
MIN_PROGRESS = 0.02     # ignore things only just started...
DONE_PROGRESS = 0.90    # ...or as good as finished


def parse_properties(text: str) -> dict[str, str]:
    """A Java .properties reader (comments, continuations, separators, escapes)."""
    props: dict[str, str] = {}
    logical, buf = [], ""
    for raw in text.splitlines():
        line = raw.lstrip()
        if not buf and (not line or line[0] in "#!"):
            continue
        trailing = len(line) - len(line.rstrip("\\"))
        if trailing % 2 == 1:
            buf += line[:-1]
            continue
        logical.append(buf + line)
        buf = ""
    if buf:
        logical.append(buf)

    def unescape(s: str) -> str:
        out, i = [], 0
        while i < len(s):
            c = s[i]
            if c == "\\" and i + 1 < len(s):
                n = s[i + 1]
                if n == "u" and i + 5 < len(s):
                    try:
                        out.append(chr(int(s[i + 2:i + 6], 16)))
                        i += 6
                        continue
                    except ValueError:
                        pass
                out.append({"t": "\t", "n": "\n", "r": "\r", "f": "\f"}.get(n, n))
                i += 2
                continue
            out.append(c)
            i += 1
        return "".join(out)

    for line in logical:
        i = 0
        while i < len(line):
            c = line[i]
            if c == "\\":
                i += 2
                continue
            if c in "=: \t\f":
                break
            i += 1
        key, rest = line[:i], line[i:]
        rest = rest.lstrip(" \t\f")
        if rest[:1] in ("=", ":"):
            rest = rest[1:].lstrip(" \t\f")
        props[unescape(key)] = unescape(rest)
    return props


def progress_files(home: Path) -> list[Path]:
    roots = [home / ".config/nuviohtpc", home / f".var/app/{FLATPAK_ID}/config/nuviohtpc"]
    files = []
    for root in roots:
        files += root.glob("accounts/*/nuvio_watch_progress.properties")
        files += root.glob("nuvio_watch_progress.properties")  # builds before account folders
    return [f for f in files if f.is_file()]


def _fraction(e: dict) -> float:
    pct = e.get("progressPercent")
    if isinstance(pct, (int, float)):
        return max(0.0, min(1.0, pct / 100))
    dur = e.get("durationMs") or 0
    return max(0.0, min(1.0, (e.get("lastPositionMs") or 0) / dur)) if dur > 0 else 0.0


def continue_watching(home: Path | None = None, limit: int = 12) -> list[dict]:
    """In-progress items, newest first, one per show (its latest episode)."""
    home = home or Path.home()
    entries = []
    for f in progress_files(home):
        try:
            props = parse_properties(f.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        for key, value in props.items():
            if not key.startswith("watch_progress_"):
                continue
            try:
                entries += [e for e in json.loads(value).get("entries", []) if isinstance(e, dict)]
            except (ValueError, AttributeError):
                continue

    entries.sort(key=lambda e: e.get("lastUpdatedEpochMs") or 0, reverse=True)
    seen, items = set(), []
    for e in entries:
        parent = e.get("parentMetaId") or ""
        if not parent or parent in seen or e.get("isCompleted"):
            continue
        frac = _fraction(e)
        if not MIN_PROGRESS <= frac < DONE_PROGRESS:
            continue
        seen.add(parent)
        season, episode = e.get("seasonNumber"), e.get("episodeNumber")
        left_min = max(0, round(((e.get("durationMs") or 0) - (e.get("lastPositionMs") or 0)) / 60000))
        where = f"S{season}:E{episode}" + (f" · {e['episodeTitle']}" if e.get("episodeTitle") else "") \
            if season and episode else ""
        subtitle = " · ".join(x for x in (where, f"{left_min} min left" if left_min else "") if x)
        items.append({
            "type": e.get("parentMetaType") or e.get("contentType") or "movie",
            "metaId": parent,
            "title": e.get("title") or "Untitled",
            "subtitle": subtitle,
            "progress": round(frac, 3),
            "backdrop": e.get("background") or e.get("episodeThumbnail") or "",
            "poster": e.get("poster") or "",
            "thumbnail": e.get("episodeThumbnail") or e.get("background") or "",
            "logo": e.get("logo") or "",
            "updated": e.get("lastUpdatedEpochMs") or 0,
        })
        if len(items) >= limit:
            break
    return items


def deep_link(item: dict) -> str:
    return f"nuvio://meta?type={quote(item['type'], safe='')}&id={quote(item['metaId'], safe='')}"
