const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { createSignaling } = require("./signaling.js");

const DEFAULT_PORT = 8765;

function loadOptions() {
  let options = {
    port: DEFAULT_PORT,
    openobserve_url: "",
    openobserve_username: "",
    openobserve_password: "",
  };
  try {
    const p = path.join("/data", "options.json");
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.port === "number") options.port = parsed.port;
      if (typeof parsed.openobserve_url === "string") options.openobserve_url = parsed.openobserve_url;
      if (typeof parsed.openobserve_username === "string") options.openobserve_username = parsed.openobserve_username;
      if (typeof parsed.openobserve_password === "string") options.openobserve_password = parsed.openobserve_password;
    }
  } catch (_) {}
  if (process.env.PORT != null) options.port = parseInt(process.env.PORT, 10) || options.port;
  if (process.env.OPENOBSERVE_URL != null) options.openobserve_url = process.env.OPENOBSERVE_URL;
  if (process.env.OPENOBSERVE_USERNAME != null) options.openobserve_username = process.env.OPENOBSERVE_USERNAME;
  if (process.env.OPENOBSERVE_PASSWORD != null) options.openobserve_password = process.env.OPENOBSERVE_PASSWORD;
  return options;
}

const options = loadOptions();
const signaling = createSignaling();
const sessions = new Map();

function sendToSession(sessionId, obj) {
  const ws = sessions.get(sessionId);
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      console.warn("sendToSession error:", e.message);
    }
  }
}

function makeOnLog(openobserveUrl, username, password) {
  if (!openobserveUrl) return () => {};
  const headers = { "Content-Type": "application/json" };
  if (username && password) {
    headers.Authorization = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
  }
  return (payload, level = "info") => {
    const body = JSON.stringify({
      "@timestamp": new Date().toISOString(),
      service: "webrtc-signaling",
      app: "webrtc-signaling",
      level,
      tag: "webrtc",
      message: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    fetch(openobserveUrl, {
      method: "POST",
      headers,
      body,
    }).catch(() => {});
  };
}

const onLog = makeOnLog(
  options.openobserve_url,
  options.openobserve_username,
  options.openobserve_password
);

function scheduleSend(sessionId, payload, delayMs) {
  setTimeout(() => sendToSession(sessionId, payload), delayMs);
}

function applyResult(result) {
  if (result.sends) {
    for (const { sessionId, payload } of result.sends) {
      sendToSession(sessionId, payload);
    }
  }
  if (result.scheduled) {
    for (const { sessionId, payload, delayMs } of result.scheduled) {
      scheduleSend(sessionId, payload, delayMs);
    }
  }
}

const PUBLIC_DIR = path.join(__dirname, "dashboard", "public");

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] || "/";

  if (url === "/api/clients") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify(signaling.getState()));
    return;
  }

  if (url === "/" || url === "/index.html") {
    const file = path.join(PUBLIC_DIR, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(data);
    });
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/webrtc" });

wss.on("connection", (ws, req) => {
  const sessionId = require("crypto").randomUUID();
  sessions.set(sessionId, ws);

  ws.on("message", (raw) => {
    let data;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    const result = signaling.handleMessage(
      sessionId,
      data,
      sendToSession,
      scheduleSend,
      onLog
    );
    applyResult(result);
  });

  ws.on("close", () => {
    const result = signaling.handleDisconnect(sessionId, sendToSession, onLog);
    applyResult(result);
    sessions.delete(sessionId);
  });

  ws.on("error", () => {
    const result = signaling.handleDisconnect(sessionId, sendToSession, onLog);
    applyResult(result);
    sessions.delete(sessionId);
  });
});

const port = options.port;
server.listen(port, "0.0.0.0", () => {
  console.log(`WebRTC signaling server listening on port ${port} (WS /webrtc, dashboard /)`);
});
