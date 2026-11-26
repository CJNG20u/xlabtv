# xLab TV

A TV home screen for Linux mini PCs: boot straight into a full-screen launcher,
pick an app with a remote or controller, and come back to the launcher when it closes.

```
login (Ubuntu desktop) ──► autostart: xlab-tv-kiosk
                   ├── xlab-tv service   127.0.0.1:8765  (lists, launches, power)
                   └── xLab TV window (GTK + WebKit) ─► the launcher UI (dist/)
                         └── launched app opens on top, closes back to the launcher
```

## Install (Ubuntu 26.04)

```sh
sudo apt install nodejs npm      # to build the UI
git clone https://github.com/CJNG20u/xlabtv.git && cd xlabtv
./install.sh               # the launcher opens full screen when you log in
./install.sh --autologin   # also logs in automatically and keeps the screen on
```

## Apps

xLab TV finds installed TV apps by itself and puts them in rows, with their own icons.
The Store's catalog (`xlabtv/catalog.json`, 40 TV-friendly apps):

- **Watch:** Nuvio, Stremio, Jellyfin, Plex, Kodi, VLC, mpv, YouTube (VacuumTube), FreeTube;
  in Chrome: Netflix, Prime Video, Disney+, HBO Max, Hulu, Paramount+, Apple TV+, Crunchyroll
- **Live & Free:** Live TV (yuki-iptv: M3U / Xtream Codes, e.g. Dispatcharr); in Chrome: Pluto TV, Tubi, Twitch
- **Music:** Spotify, Plexamp, TIDAL, YouTube Music, Radio (Shortwave)
- **Play:** Steam (Big Picture), Moonlight, GeForce NOW, Xbox Cloud (Greenlight),
  PS Remote Play (chiaki-ng), Heroic, Lutris, RetroArch, RetroDECK, Dolphin, PCSX2, PPSSPP
- **Web:** Firefox, Chrome

Install them from the **Store** on the TV, or from a terminal:

```sh
xlab-tv-apps list                          # what's available and installed
xlab-tv-apps install youtube jellyfin      # Flatpaks, no password needed
```

Everything installs as a per-user Flatpak (Flathub, and Nuvio's own signed repo), so the
Store needs no password. Store installs can be removed from the Store again; apps
installed some other way (a .deb, Ubuntu's App Center) are left alone.

New apps show up the next time xLab TV starts (log out and back in). To add your own app,
hide one, or set your own rows, edit `~/.config/xlab-tv/apps.json`:

```json
{
  "hidden": ["freetube"],
  "apps": {
    "iptv": { "name": "Live TV", "subtitle": "Dispatcharr", "color": "#0f766e",
              "row": "Watch", "command": ["flatpak", "run", "tv.kodi.Kodi"] }
  },
  "hero": ["nuvio"]
}
```

An app in `apps` with a catalog id (e.g. `"youtube"`) replaces that catalog entry.
Optional keys per app: `icon` and `backdrop` (image paths). Check your edits with
`python3 /usr/lib/xlab-tv/xlabtv/server.py --check`.

Netflix, Prime Video and Disney+ open in Chrome (install with `xlab-tv-apps install netflix`);
on Linux these services stream at lower resolution than on a TV or streaming stick.

## The UI

The front end is the React + Vite app at the repo root (`src/`, designed in Google AI
Studio). `install.sh` builds it to `dist/` and the service serves it. Until it's built,
a simple built-in page is used. The backend lives in `xlabtv/`, `session/` and `tests/`.

The UI talks to the service through this API. Every `/api/*` call needs the header
`X-XLab-Token`, read from `<meta name="xlab-token">` in the served page.

| Call | Body | Answer |
|---|---|---|
| `GET /api/apps` | | `{hero: [{id, appId, title, subtitle, backdrop}], rows: [{title, items: [{id, name, subtitle, icon, color}]}], power}` |
| `POST /api/launch` | `{"id": "nuvio"}` | `{ok: true}` or `{ok: false, error}` |
| `GET /api/status` | | `{running: "nuvio" \| null}` |
| `GET /api/store` | | `{items: [{id, name, subtitle, description, category, color, icon, installed, job}]}`, `job` = `null` or `{action, state: queued\|running\|done\|failed, message}` |
| `POST /api/store` | `{"id": "youtube", "action": "install" \| "remove"}` | `{ok: true}` (202), then poll `GET /api/store` |
| `POST /api/power` | `{"action": "suspend" \| "reboot" \| "poweroff" \| "exit"}` | `{ok: true}` |

`exit` closes the launcher and leaves the Ubuntu desktop.

## Develop

```sh
python3 -m unittest discover -s tests        # backend tests
npm install && npm run build
python3 xlabtv/server.py --config apps.example.json --ui dist
```

Logs: `~/.local/state/xlab-tv/service.log` and `apps.log`.
