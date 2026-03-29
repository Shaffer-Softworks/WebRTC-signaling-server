# WebRTC signaling — design and client context

## Where to make changes (**this repo only**)

**All standalone signaling server work** (protocol, fixes, tests, ops docs, Cursor rules for this add-on) belongs in **[WebRTC-signaling-server](https://github.com/Shaffer-Softworks/WebRTC-signaling-server)** under **`webrtc_signaling/`** (npm package name **webrtc-signaling-addon**). Do not implement or document the add-on server inside the **RPI** Android repo for that purpose; RPI keeps a **Node-RED export** (`node-red/nodered-signaling-server.js`, etc.) only as a **legacy reference** for the same protocol.

Long-form agent/editor guidance for **this** project: [`.cursor/rules/webrtc-signaling-addon.mdc`](../.cursor/rules/webrtc-signaling-addon.mdc) (open this repository in Cursor).

---

This add-on implements the **Direct-Calling Signaling Router** protocol so it can **replace the Node-RED WebSocket flow** used for LAN intercom signaling. Node-RED reference script (sibling repo **RPI**): `node-red/nodered-signaling-server.js`.

## Client: Android (RPI intercom)

The Kotlin app uses the same JSON message types (`register`, `registered`, `replaced`, `offer`, `answer`, `candidate`, `hangup`, `unavailable`, `error`, `getClients`, `clientsList`, `heartbeat`). Registration includes `displayName`; the server echoes `clientId` in `registered` and may send `replaced` when the same `clientId` connects from a new WebSocket session.

**Client behavior to be aware of when changing the server:**

- **Ktor WebSocket** signaling client uses a **~20s WebSocket ping** toward the server (responds with pong at the `ws` layer).
- **Application heartbeat** is sent about every **30s** so sessions stay within the server’s **90s** stale window (`STALE_CLIENT_MS` in `signaling.js`).
- On **`replaced`** or **`not_registered`**, the app performs a **full signaling reconnect** (unregister path + new connection + `register`) so it does not spin on a half-valid socket.

Point the app at **`ws://<host>:<port>/webrtc`** (default port **8765** from add-on config).

## Parity with Node-RED (zombie / `not_registered`)

A failure mode seen with Node-RED was: server **removed** a session from its maps (re-register eviction or stale prune) but the **old TCP/WebSocket stayed open**. The client kept sending; the server answered **`not_registered`**.

**Node-RED fix:** `tryCloseWebSocketSession()` when evicting an old session after `replaced` and when pruning stale sessions.

**This add-on:** `server.js` passes **`terminateSession(sessionId)`** into `createSignaling()`. **`signaling.js`** calls it on **same-`clientId` eviction** and inside **`pruneStaleClients`**. That matches the Node-RED intent: drop the socket when server state no longer tracks that session.

Separately, **`server.js`** runs a **30s WebSocket ping** loop and **`terminate()`**s clients that do not pong — useful for **half-open** links; it does not replace the app-level stale roster + **`terminateSession`** behavior above.

## Operations vs Node-RED

| Topic | Node-RED flow | This add-on |
|--------|----------------|-------------|
| OpenObserve | Often stream `node_red` | Same HTTP ingest URL works; body uses `tag: "webrtc"` / `service: webrtc-signaling` — align stream name in OpenObserve if you want separation. |
| HA client roster over MQTT | Side flow (e.g. `webrtc/signaling/clients`) | No MQTT. Use **`GET /api/clients`** from an automation or a small publisher if you need MQTT. |
| Dashboard / roster | Flow context + debug | **`/`** dashboard, **`/api/clients`** JSON. |

## Testing

**Unit-style parity checks** (eviction + stale prune call `terminateSession`):

```bash
npm install
npm test
```

**Without local Node**, e.g. Docker:

```bash
docker run --rm -v "$(pwd):/app" -w /app node:22-alpine sh -c "npm install --silent && npm test"
```

End-to-end: run `node server.js`, connect two WebSockets to `/webrtc`, register the same `clientId` twice; the first connection should close after `replaced`, and logs should show a normal WebSocket close for that session.

## Files

| File | Role |
|------|------|
| `signaling.js` | Protocol router, maps `clientId` ↔ session id, prune, routing. |
| `server.js` | HTTP + `ws` WebSocketServer on `/webrtc`, session map, ping sweep, OpenObserve logging hook. |
| `verify-terminate-parity.test.js` | Regression tests for `terminateSession` on eviction and prune. |
