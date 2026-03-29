# WebRTC Signaling Server

Home Assistant add-on: a standalone WebSocket signaling server for LAN intercom, with a dashboard. It implements the same **Direct-Calling Signaling Router** flow as the legacy Node-RED WebSocket node (`register`, `registered`, `replaced`, `offer`, `answer`, `candidate`, `hangup`, `unavailable`, `getClients`, `clientsList`, `heartbeat`, etc.).

**Deep dive** (Android client behavior, Node-RED parity, operations, tests): [SIGNALING_CONTEXT.md](./SIGNALING_CONTEXT.md)  
**Cursor:** [`.cursor/rules/webrtc-signaling-addon.mdc`](../.cursor/rules/webrtc-signaling-addon.mdc) (applies when editing files under `webrtc_signaling/`)

**Install via Home Assistant:** [Repository README](../README.md) (custom repo URL and troubleshooting).

---

## Endpoints

| What | Location |
|------|----------|
| Dashboard | `http://<host>:<port>/` |
| WebSocket | `ws://<host>:<port>/webrtc` |
| Client list (JSON) | `http://<host>:<port>/api/clients` |

Default port **8765** (configurable in the add-on options).

## Configuration

The Supervisor writes **`/data/options.json`** from the add-on UI. For local development you can create that file (or use env vars).

| Option / env | Role |
|----------------|------|
| `port` / `PORT` | Listen port |
| `openobserve_url` / `OPENOBSERVE_URL` | Optional log ingest URL |
| `openobserve_username` / `OPENOBSERVE_USERNAME` | Optional Basic auth user |
| `openobserve_password` / `OPENOBSERVE_PASSWORD` | Optional Basic auth password |

## Local run

```bash
npm install
node server.js
```

## Docker

```bash
docker build -t webrtc-signaling .
docker run -p 8765:8765 webrtc-signaling
```

## Tests

```bash
npm test
```

See [SIGNALING_CONTEXT.md](./SIGNALING_CONTEXT.md#testing) for Docker-only runs and manual checks.

## Client connection state

If the server stops or the socket drops, the WebSocket closes. **Treat `close` and `error` as disconnected** so the UI does not show “connected” when signaling is down.

1. On **`open`** — mark connected, then send **`register`** first. Do not send `getClients` or `heartbeat` until you receive **`registered`** (otherwise you may get `not_registered`).
2. On **`close`** or **`error`** — mark disconnected; reconnect after a delay if you want.

```js
ws.onopen = () => { /* connected → send register */ };
ws.onclose = () => { /* disconnected */ };
ws.onerror = () => { /* disconnected */ };
```

The server sends **WebSocket ping** frames (~30s). Clients must **pong** (browsers and the `ws` library do this automatically). Idle connections that never pong are closed so the roster and dashboard stay accurate.

## Local add-on copy (developers)

To run this folder as a **local** add-on, copy `webrtc_signaling/` into your HA configuration (e.g. `addons/webrtc_signaling/`), refresh local add-ons, configure, and start. For most users, installing from the [custom repository](../README.md) is simpler.
