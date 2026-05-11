# Signaling design and client context

**Cursor:** With files under `webrtc_signaling/` open, the agent rule [`.cursor/rules/webrtc-signaling-addon.mdc`](../.cursor/rules/webrtc-signaling-addon.mdc) summarizes scope and invariants (full detail stays in this file).

## Repository scope

Signaling server work (protocol, tests, ops behavior) lives in this repo under **`webrtc_signaling/`** (`package.json` name: `webrtc-signaling-addon`). The canonical GitHub tree is **[WebRTC-signaling-server](https://github.com/Shaffer-Softworks/WebRTC-signaling-server)**.

Do **not** treat the **RPI** Android repo as the source of truth for this server; it is a **protocol consumer**. Behavior and compatibility are defined here and in the source under **`webrtc_signaling/`**.

## Android client (RPI intercom)

The app uses the same message types as this server, including `replaced` and application-level `heartbeat`. Registration sends `displayName`; the server responds with `registered` and may send `replaced` when the same `clientId` attaches to a new session.

**Server authors should keep in mind:**

| Behavior | Detail |
|----------|--------|
| Ktor WebSocket ping | ~20s toward the server (layer responds with pong) |
| App heartbeat | ~every 30s — keeps the session inside the server’s **90s** stale window (`STALE_CLIENT_MS` in `src/signaling.js`) |
| `replaced` / `not_registered` | App does a **full signaling reconnect** (new socket + `register`) instead of retrying on a half-valid session |

Target URL: **`ws://<host>:<port>/webrtc`** (default port **8765**).

## Session cleanup (zombies / `not_registered`)

**Problem:** The server dropped a session from its maps (re-register eviction or stale prune) but the **old WebSocket stayed open**. The client kept sending; the server replied **`not_registered`**.

**Intended fix:** whenever a session is evicted or pruned, the corresponding socket must be **force-closed** so the client reconnects instead of talking to a dead session id.

**This add-on:** `src/index.js` injects **`terminateSession(sessionId)`** into `createSignaling()`. **`src/signaling.js`** calls it on same-`clientId` eviction and inside **`pruneStaleClients`**.

Additionally, **`src/index.js`** runs two keepalive mechanisms:

1. **WebSocket-level ping** (`ws.ping()`, 30s) — detects dead TCP sockets; `terminate()` if no pong. Logs `ws_ping_timeout` on kill.
2. **Application-level ping** (`{"type":"ping","ts":…}`, 25s) — sends a **JSON data frame** to every connected client. This keeps reverse proxy idle timers alive; many proxies (HAProxy in OPNsense, nginx) only count **data frames** (opcode 0x1/0x2), not WS control-frame pings (opcode 0x9), toward their tunnel timeout.

Without the app-level ping, proxies with a `timeout tunnel` of ~180s would kill the WS connection every ~3 minutes even though WS-level pings were flowing. The client sees `Signaling WebSocket incoming channel closed (server closed connection?)` when this happens.

`src/signaling.js` handles `{"type":"pong"}` from clients silently (touches `lastActivity`, no logging). The client's own `heartbeat` (every ~30s) also generates upstream data frames.

## Operations notes

| Topic | This add-on |
|--------|-------------|
| OpenObserve | Ingest URL + optional **Basic auth** (`openobserve_username` / `openobserve_password`); payload uses `tag: "webrtc"` / `service: "webrtc-signaling"`. Route streams in OpenObserve to match your ingest URL path if needed. |
| Client roster over MQTT | No MQTT; use **`GET /api/clients`** or a small bridge if you need MQTT. |
| Dashboard | **`/`** and **`/api/clients`**. |

## Dashboard and `GET /api/clients` (saved context)

- **Dashboard UI:** `webrtc_signaling/ui/index.html`, served at **`/`** by `src/index.js`. Static HTML/JS (no build step): client roster table with search, refresh interval, “Refresh now”, per-row copy client ID, JSON export; stat cards driven by polling **`GET /api/clients`**.
- **HTTP vs WebSocket roster:** `src/signaling.js` **`buildClientsList()`** includes **`inCallWith`** and **`lastActivity`** on each client object. **`getState()`** / **`/api/clients`** expose that full shape. WebSocket **`clientsList`** broadcasts still map to **`{ clientId, displayName, inCall }`** only (stable wire shape for clients — do not add fields there without a protocol decision).
- **`GET /api/clients` response:** `{ "clients": [...], "meta": { ... } }`. Backward compatible: consumers that only read **`clients`** keep working.

**`meta` object (as implemented in `src/index.js`):**

| Field | Meaning |
|--------|--------|
| `serverTime` | ISO timestamp when the response was built |
| `wsConnections` | Open WebSocket sessions (`sessions.size`) |
| `staleClientAfterMs` | Same as **`STALE_CLIENT_MS`** in `src/signaling.js` (90s) |
| `process` | **This Node process:** `rssBytes`, `heapUsedBytes`, `heapTotalBytes`, `cpuPercent`. **`cpuPercent`** is **null on the first** `/api/clients` response after startup (no prior sample); later values are process CPU time vs wall time since the **previous** request, scaled as ~**one logical CPU** (can exceed 100% if multi-threaded). |
| `hostMemory` | **`os.totalmem()`** / **`os.freemem()`** — inside Docker, may reflect the **host VM** or **cgroup** view depending on runtime; treat as indicative. |
| `hostCpu` | **`cpuPercent`** from summed **`os.cpus()`** tick deltas since the **previous** `/api/clients` request (**null** first time), plus **`logicalCores`**. System-wide busy vs idle over the poll interval; Docker may show the environment the container sees. |

**Local Docker quick check:** from `webrtc_signaling/`, `docker build -t webrtc-signaling-local .` then `docker run --rm -p 8765:8765 webrtc-signaling-local` — open **`http://localhost:8765/`**.

## Testing

```bash
npm install
npm test
```

**Without a local Node install** (the test file only needs Node’s built-in `assert` and `src/signaling.js`; it does not load `ws`):

```bash
docker run --rm -v "$(pwd):/app:ro" -w /app node:22-alpine node verify-terminate-parity.test.js
```

**Cursor agent** (macOS, Docker Desktop socket):

```bash
DOCKER_HOST=unix:///var/run/docker.sock \
  docker run --rm -v "$(pwd):/app:ro" -w /app node:22-alpine node verify-terminate-parity.test.js
```

**Manual check:** Run `node src/index.js`, open two clients on `/webrtc`, register the same `clientId` twice; the first connection should receive `replaced` and close, with a normal close in the server log.

## Source files

| File | Role |
|------|------|
| `src/signaling.js` | Protocol router, `clientId` ↔ session maps, stale prune, message routing |
| `src/index.js` | HTTP static + API, `WebSocketServer` on `/webrtc`, sessions, ping sweep, OpenObserve hook |
| `verify-terminate-parity.test.js` | 4 tests: eviction, stale prune, pong handling, unregistered pong error |

## Home Assistant add-on (Supervisor) — saved context

Repo URL: **[Shaffer-Softworks/WebRTC-signaling-server](https://github.com/Shaffer-Softworks/WebRTC-signaling-server)**. Add in the store as `https://github.com/Shaffer-Softworks/WebRTC-signaling-server#main`.

| Topic | Requirement / pitfall |
|--------|------------------------|
| **Layout** | Root **`repository.yaml`**; add-on folder **`webrtc_signaling/`** must match **`slug: webrtc_signaling`** in `config.yaml`. |
| **Schema** | Option types use Supervisor regex. Port: **`int(1,65535)?`** (not `int(8765)?`). Optional strings: **`str?`**; optional password: **`password?`**. |
| **`build.yaml`** | **`build_from`** uses full **`ghcr.io/home-assistant/<arch>-base:3.21`** images (same pattern as **apk-update-service**). Short names are rejected by Supervisor. |
| **Dockerfile** | **`ARG BUILD_FROM`** / **`FROM ${BUILD_FROM}`**; **`RUN apk add --no-cache nodejs npm`**; **`WORKDIR /opt/app`**; copy **`package.json`** / lockfile, **`npm ci --omit=dev`** (or **`npm install`** if no lockfile); copy **`src/`** and **`ui/`**; **`run.sh`** runs **`node src/index.js`** via **`with-contenv`**. |
| **Options** | **`/data/options.json`**: `port`, `openobserve_url`, `openobserve_username`, `openobserve_password`. Env: `PORT`, `OPENOBSERVE_*`. Ingest sends **Basic auth** when username and password are both set. |
| **`icon.png`** | Must be a valid PNG (meaningful size); tiny placeholder PNGs break in the store UI. |
| **Store UI** | Custom add-ons appear **at the bottom** of the add-on store. Parse failures often log as **WARNING** in Supervisor logs, not ERROR. |
| **Open dashboard** | Same ingress pattern as **apk-update-service**: **`ingress: true`**, **`ingress_port: 8765`**, **`panel_title`** / **`panel_icon`**, **`startup: services`**, **`boot: auto`**, **`hassio_api: false`**, **`homeassistant_api: false`**. Core proxies the UI at **`/api/hassio_ingress/<token>/…`** (older: **`/hassio/ingress/<slug>/…`**); the dashboard script prefixes **`/api/clients`** and **`/webrtc`** with that base. **Inside the HA shell:** turn on **Show in sidebar** on the add-on **Info** tab (Supervisor persists **`ingress_panel`**); that registers the built-in **app** panel so the UI opens in the main layout like **APK Updates**, instead of only opening ingress in a separate full-tab flow. **`ports`** / **`port`** must stay aligned with **`ingress_port`**. |

Editor/agent invariants: **`.cursor/rules/webrtc-signaling-addon.mdc`**. User-facing install notes: root **`README.md`**; add-on quickstart: **`webrtc_signaling/README.md`**.
