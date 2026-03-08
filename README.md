# WebRTC Signaling Server (Home Assistant Addon)

Standalone WebRTC signaling server for LAN intercom, with a dashboard.

**Repository:** https://github.com/Shaffer-Softworks/WebRTC-signaling-server.git Compatible with the Node-RED "Signaling Router" protocol.

## Local run

```bash
npm install
node server.js
```

- Dashboard: http://localhost:8765/
- WebSocket: ws://localhost:8765/webrtc
- API: http://localhost:8765/api/clients

Options: set `PORT` and optionally `OPENOBSERVE_URL`, or create `/data/options.json` with `{ "port": 8765, "openobserve_url": "" }`.

## Docker

```bash
docker build -t webrtc-signaling .
docker run -p 8765:8765 webrtc-signaling
```

## Home Assistant addon

Copy this folder into your HA addons directory (e.g. `addons/webrtc_signaling/`). The addon reads `/data/options.json` for `port` and `openobserve_url`. Configure the addon in the UI and start it; then use the dashboard and WebSocket URL (e.g. `ws://homeassistant.local:8765/webrtc`) from your intercom clients.
