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

One line, from the ready-made package (no git or Node.js needed):

```sh
wget -qO- https://github.com/CJNG20u/xlabtv/releases/download/latest/get.sh | sh
wget -qO- https://github.com/CJNG20u/xlabtv/releases/download/latest/get.sh | sh -s -- --autologin
```

The second also logs in automatically and keeps the screen on. The **Updates** tile
(and the gear's badge) then follows new packages. GitHub builds the package on every
push to `main` that passes the checks, as the rolling **latest** release
(`xlab-tv.tar.gz`, `get.sh`, `VERSION`).

For development, from a git checkout (builds the UI with Node.js; Updates then does `git pull`):

```sh
sudo apt install git nodejs npm
git clone https://github.com/CJNG20u/xlabtv.git && cd xlabtv
sh install.sh               # add --autologin to also log in automatically
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
- **System** (built in, not in the Store): **Terminal**, and **Updates**, which updates xLab TV
  (`git pull` + `install.sh`), your Flatpak apps and Ubuntu in a terminal window. Ubuntu's
  part asks for your password: type it with the phone remote.

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

## App previews in the hero (Nuvio, YouTube)

Like Google TV, an app can bring its own content: focus its card and the hero shows it.

- **Nuvio:** your Continue watching, read (read-only) from Nuvio's watch progress in
  `~/.config/nuviohtpc` or the Flatpak's `~/.var/app/com.nuvio.media.desktop/config/nuviohtpc`,
  newest first, one per show. Opening one uses Nuvio's `nuvio://meta?type=…&id=…` link.
  Until an app is focused, the hero starts on what you were last watching.
  Set `"continue_row": true` in apps.json to also get a Continue watching row.
- **YouTube:** the latest videos of channels you list in apps.json (YouTube's public channel
  feeds, no account or API key; Shorts are skipped), refreshed every 30 minutes. Opening one
  plays it in VacuumTube (`<url> --fullscreen`).

```json
{ "youtube": { "channels": ["@mkbhd", "@veritasium", "UCxxxxxxxxxxxxxxxxxxxxxx"] } }
```

In `/api/apps`, an app item with content has `previews`: a list of hero items
(`id, title, subtitle, backdrop, backdropFallback, eyebrow, logo, progress?, kind: "media"`);
launch one with `POST /api/launch {"id": <preview id>}`.

## Remote buttons and the Home button

Several apps can be open at once. **Home** brings xLab TV to the front and leaves the app
running, like a TV box:

- `install.sh` installs **keyd** with `/etc/keyd/xlab-tv.conf`: a remote's **Back** key
  becomes **Esc** (which every app understands) and its **Home** key becomes **F20**.
  If you already have a keyd config, it prints the two lines to add instead.
- It also installs the **xLab TV GNOME extension** (`gnome-extension/xlab-tv@xlab.tv`), which
  turns F20 into "show the launcher" and offers the same over D-Bus:
  `gdbus call --session --dest org.gnome.Shell --object-path /tv/xlab/Shell --method tv.xlab.Shell.ShowLauncher`.
  GNOME loads it at the next login.
- The phone remote's Home uses the extension too; without it, Home closes the most recent app.

## Phone remote

The service also serves a remote for your phone on the home network
(`http://<this-pc>:8766/remote`). Pair a phone once with the 6-digit code from the TV
(or its QR code); it then has buttons (D-pad, OK, Back = Esc, Home = close the app in
front, play/pause, volume), a touchpad, typing, app shortcuts and power. Keys go to a
virtual keyboard and mouse, so they work in every app. On Android, use Chrome's
"Add to Home screen" to keep it as an app.

- Pairing codes last 5 minutes or 5 wrong tries; each phone gets its own token,
  kept in `~/.config/xlab-tv/remotes.json`. `POST /api/remote {"action": "forget"}`
  unpairs every phone.
- `install.sh` lets the logged-in user use `/dev/uinput` (the rule Steam uses) and
  opens port 8766 if ufw is on. Turn the remote off with `--remote-port 0`.

### Turning the TV on (Wake-on-LAN)

A web page can't send the "magic packet" that wakes a PC, and the remote page lives on
the PC that is asleep, so waking it needs something that stays on: Home Assistant (its
**Wake on LAN** integration, with the MAC address below), a router with a WoL page, or a
future native phone app. What the PC needs:

- `install.sh` turns on Wake-on-LAN for your network connections (NetworkManager).
- In the BIOS, enable Wake on LAN / "Power on by PCI-E", and disable ErP / deep sleep
  if you want to wake it from off, not only from sleep.
- Use Ethernet: Wi-Fi cards can at best wake the PC from sleep, and many can't at all.
- The MAC address to wake: `wake.mac` in `GET /api/remote` (or `ip link`).

TV side: `GET /api/remote` → `{url, pairUrl, code, expiresIn, devices, inputError, wake: {mac, interface, wireless}}`;
show `code` and a QR code of `pairUrl`. Phone side (header `X-Remote-Token`):
`POST /remote/pair {code, name}` → `{token}`, `POST /remote/key {key}` (up, down, left,
right, ok, back, home, playpause, volup, voldown, mute, space, backspace, tab,
fullscreen), `POST /remote/text {text}`, `POST /remote/mouse {dx, dy} | {click} | {scroll}`,
`POST /remote/launch {id}`, `POST /remote/power {action}`, `GET /remote/apps`.
`/remote/key` also takes an app's shortcut letters (`a`-`z`, `0`-`9`) and `f1`-`f12`.
`GET /remote/apps` includes `appButtons`: the shortcuts of the app in front, from its
`buttons` in the catalog (`{app, name, groups: [{title, buttons: [{label, key, hint?}]}]}`);
no app has any at the moment (Nuvio's were removed: the touchpad works better there).

## The UI

The front end is the React + Vite app at the repo root (`src/`, designed in Google AI
Studio). `install.sh` builds it to `dist/` and the service serves it. Until it's built,
a simple built-in page is used. The backend lives in `xlabtv/`, `session/` and `tests/`.

The UI talks to the service through this API. Every `/api/*` call needs the header
`X-XLab-Token`, read from `<meta name="xlab-token">` in the served page.

| Call | Body | Answer |
|---|---|---|
| `GET /api/apps` | | `{hero: [{id, appId, title, subtitle, backdrop}], rows: [{title, items: [{id, name, subtitle, icon, color}]}], power}` |
| `POST /api/launch` | `{"id": "nuvio"}` | `{ok: true}` or `{ok: false, error}`. Several apps can be open; launching an open one brings it forward |
| `GET /api/status` | | `{running: id \| null, open: [ids]}`: `running` is the app being opened (only for the first 8 s after a launch); `open` lists every app still running, most recent last |
| `POST /api/close` | `{"id": "nuvio"}` | `{ok: true}`, or 404 if it isn't open |
| `GET /api/store` | | `{items: [{id, name, subtitle, description, category, color, icon, installed, job}]}`, `job` = `null` or `{action, state: queued\|running\|done\|failed, message}` |
| `POST /api/store` | `{"id": "youtube", "action": "install" \| "remove"}` | `{ok: true}` (202), then poll `GET /api/store` |
| `POST /api/power` | `{"action": "suspend" \| "reboot" \| "poweroff" \| "exit"}` | `{ok: true}` |

`exit` closes the launcher and leaves the Ubuntu desktop.

App management and quick settings (same token):

| Call | Body | Answer |
|---|---|---|
| `POST /api/apps/hide` | `{"id", "hidden": true\|false}` | `{ok}`; saved in apps.json `hidden` |
| `GET /api/apps/hidden` | | `{apps: [{id, name}]}` |
| `POST /api/apps/move` | `{"id", "direction": "left"\|"right"\|"first"\|"last"}` | `{ok}`; saved in apps.json `order` |
| `GET /api/settings/wifi` | | `{enabled, ethernet, connected: {ssid, signal}\|null, networks: [{ssid, signal, secure, connected}]}` |
| `POST /api/settings/wifi` | `{"action": "rescan"\|"connect"\|"disconnect"\|"power", ssid?, password?, on?}` | `{ok, ...status}` or 409 `{ok: false, error}` |
| `GET /api/settings/bluetooth` | | `{available, powered, devices: [{mac, name, paired, connected}]}` |
| `POST /api/settings/bluetooth` | `{"action": "scan"\|"pair"\|"connect"\|"disconnect"\|"remove"\|"power", mac?, on?}` | `{ok, ...status}` (scan takes ~8 s, pair up to ~30 s) |
| `GET /api/settings/audio` | | `{outputs: [{id, name, default}], volume: 0-100, muted}` |
| `POST /api/settings/audio` | `{"action": "output"\|"volume"\|"up"\|"down"\|"mute", id?, level?}` | `{ok, ...status}` |
| `POST /api/settings/open` | `{"page": "display"\|"sound"\|"wifi"\|"bluetooth"\|"power"}` | opens that page of Ubuntu's Settings |
| `GET /api/updates` | | `{xlabtv, apps, system, total, checked}`: what the Updates tile would install (checked 2 min after start, then every 6 h) |

## Develop

```sh
python3 -m unittest discover -s tests        # backend tests
npm install && npm run build
python3 xlabtv/server.py --config apps.example.json --ui dist
```

Logs: `~/.local/state/xlab-tv/service.log` and `apps.log`.
