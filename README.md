# xLab TV

A TV home screen for Linux mini PCs: boot straight into a full-screen launcher,
pick an app with a remote or controller, and come back to the launcher when it closes.

```
login screen ──► "xLab TV" session (cage kiosk)
                   ├── xlab-tv service   127.0.0.1:8765  (lists, launches, power)
                   └── Firefox --kiosk ─► the launcher UI (dist/)
                         └── launched app opens on top, closes back to the launcher
```

## Install (Ubuntu 26.04)

```sh
sudo apt install nodejs npm      # to build the UI
git clone https://github.com/CJNG20u/xlabtv.git && cd xlabtv
./install.sh               # adds the "xLab TV" session to the login screen
./install.sh --autologin   # same, and boots straight into it
```

Then edit `~/.config/xlab-tv/apps.json` to add your apps (see `apps.example.json`).
Each app is a name, a colour, an optional `icon`/`backdrop` image path, and the
command that starts it, written as a list (`["flatpak", "run", "org.example.App"]`).
Check your edits with:

```sh
python3 /usr/lib/xlab-tv/xlabtv/server.py --check
```

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
| `POST /api/power` | `{"action": "suspend" \| "reboot" \| "poweroff" \| "exit"}` | `{ok: true}` |

`exit` closes xLab TV and returns to the login screen.

## Develop

```sh
python3 -m unittest discover -s tests        # backend tests
npm install && npm run build
python3 xlabtv/server.py --config apps.example.json --ui dist
```

Logs: `~/.local/state/xlab-tv/service.log` and `apps.log`.
