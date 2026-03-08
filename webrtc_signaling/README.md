# WebRTC Signaling Server (Home Assistant Addon)

Standalone WebRTC signaling server for LAN intercom, with a dashboard.

**Repository:** https://github.com/Shaffer-Softworks/WebRTC-signaling-server

Implements the same **Direct-Calling Signaling Router** protocol as the Node-RED WebSocket function node (register, registered, offer/answer/candidate, hangup, unavailable, getClients, clientsList, heartbeat; same data structures and stale pruning).

## Local run

```bash
npm install
node server.js
```

- Dashboard: http://localhost:8765/
- WebSocket: ws://localhost:8765/webrtc
- API: http://localhost:8765/api/clients

Options: set `PORT` and optionally `OPENOBSERVE_URL` (and `OPENOBSERVE_USERNAME` / `OPENOBSERVE_PASSWORD` for Basic auth), or create `/data/options.json` with `port`, `openobserve_url`, `openobserve_username`, `openobserve_password`.

## Docker

```bash
docker build -t webrtc-signaling .
docker run -p 8765:8765 webrtc-signaling
```

## Home Assistant addon

Copy this folder into your HA addons directory (e.g. `addons/webrtc_signaling/`). The addon reads `/data/options.json` for `port` and `openobserve_url`. Configure the addon in the UI and start it; then use the dashboard and WebSocket URL (e.g. `ws://homeassistant.local:8765/webrtc`) from your intercom clients.

## Device / client connection state

When the server stops or the connection drops, the WebSocket will close. **Clients must treat `close` and `error` as disconnected** so the device UI does not show "connected" when the server is down.

- **WebSocket `open`** → set connection state to **connected**, then send **`register`** as the first message. Do not send `getClients` or `heartbeat` until after you have received `registered` (otherwise the server responds with `not_registered` and the device can appear to drop).
- **WebSocket `close`** or **`error`** → set connection state to **disconnected** (and optionally try to reconnect after a delay).

Example (browser or Node client):

```js
let connected = false;

function setConnected(value) {
  connected = value;
  // Update your UI or app state here
}

ws.onopen = () => setConnected(true);

ws.onclose = () => setConnected(false);
ws.onerror = () => setConnected(false);
```

The server sends protocol-level ping frames; clients that respond with pong (automatic in browsers and the `ws` library) stay visible. Connections that do not respond are closed by the server so they disappear from the dashboard and other clients get an updated `clientsList`.
