const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const { createSignaling, STALE_CLIENT_MS } = require("./signaling.js");

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
const sessions = new Map();

/** CPU % is process time vs wall time since the previous sample (~one logical CPU). */
let prevCpuUsage = null;
let prevHrTime = null;

function getProcessResourceSample() {
  const mem = process.memoryUsage();
  const cpuNow = process.cpuUsage();
  const hrNow = process.hrtime.bigint();

  let cpuPercent = null;
  if (prevCpuUsage != null && prevHrTime != null) {
    const userDelta = cpuNow.user - prevCpuUsage.user;
    const systemDelta = cpuNow.system - prevCpuUsage.system;
    const wallMicros = Number((hrNow - prevHrTime) / 1000n);
    const cpuMicros = userDelta + systemDelta;
    if (wallMicros > 0) {
      cpuPercent = (cpuMicros / wallMicros) * 100;
      cpuPercent = Math.round(Math.min(999, cpuPercent) * 10) / 10;
    }
  }
  prevCpuUsage = cpuNow;
  prevHrTime = hrNow;

  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    cpuPercent,
  };
}

/** Host CPU % from summed os.cpus() tick deltas since the previous sample (0–100%, all logical cores). */
let prevHostCpuTicks = null;

function getHostCpuSample() {
  const cpus = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;
  for (const c of cpus) {
    const t = c.times;
    user += t.user;
    nice += t.nice;
    sys += t.sys;
    idle += t.idle;
    irq += t.irq;
  }

  let cpuPercent = null;
  if (prevHostCpuTicks != null) {
    const du = user - prevHostCpuTicks.user;
    const dn = nice - prevHostCpuTicks.nice;
    const ds = sys - prevHostCpuTicks.sys;
    const di = idle - prevHostCpuTicks.idle;
    const dq = irq - prevHostCpuTicks.irq;
    if (du >= 0 && dn >= 0 && ds >= 0 && di >= 0 && dq >= 0) {
      const dTotal = du + dn + ds + di + dq;
      if (dTotal > 0) {
        const dBusy = du + dn + ds + dq;
        cpuPercent = (dBusy / dTotal) * 100;
        cpuPercent = Math.round(Math.min(100, Math.max(0, cpuPercent)) * 10) / 10;
      }
    }
  }
  prevHostCpuTicks = { user, nice, sys, idle, irq };

  return {
    cpuPercent,
    logicalCores: cpus.length,
  };
}

/** Force-close a WebSocket by session id (parity with Node-RED tryCloseWebSocketSession on eviction/prune). */
function terminateSession(sessionId) {
  const ws = sessions.get(sessionId);
  if (!ws) return;
  try {
    ws.terminate();
  } catch (e) {
    console.warn("terminateSession:", e.message);
  }
}

const signaling = createSignaling({ terminateSession });

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

/** Log to addon log (stdout/stderr) so it appears in Home Assistant addon log. */
function logToAddon(payload, level = "info") {
  const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
  const line = `[webrtc] ${level.toUpperCase()}: ${msg}`;
  if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    console.debug(line);
  } else {
    console.log(line);
  }
}

function makeOnLog(openobserveUrl, username, password) {
  const headers = { "Content-Type": "application/json" };
  if (username && password) {
    headers.Authorization = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
  }
  return (payload, level = "info") => {
    logToAddon(payload, level);
    if (openobserveUrl) {
      const body = JSON.stringify({
        "@timestamp": new Date().toISOString(),
        service: "webrtc-signaling",
        app: "webrtc-signaling",
        level,
        tag: "webrtc",
        message: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
      fetch(openobserveUrl, { method: "POST", headers, body }).catch(() => {});
    }
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
    const { clients } = signaling.getState();
    res.end(
      JSON.stringify({
        clients,
        meta: {
          serverTime: new Date().toISOString(),
          wsConnections: sessions.size,
          staleClientAfterMs: STALE_CLIENT_MS,
          process: getProcessResourceSample(),
          hostMemory: {
            totalBytes: os.totalmem(),
            freeBytes: os.freemem(),
          },
          hostCpu: getHostCpuSample(),
        },
      })
    );
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

const WS_PING_INTERVAL_MS = 30000;
const APP_PING_INTERVAL_MS = 25000;

const wss = new WebSocketServer({ server, path: "/webrtc" });

wss.on("connection", (ws, req) => {
  const sessionId = require("crypto").randomUUID();
  sessions.set(sessionId, ws);
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    ws.isAlive = true;
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

  function cleanup(code, reason) {
    if (!sessions.has(sessionId)) return;
    sessions.delete(sessionId);
    if (code !== undefined) {
      onLog(
        { type: "websocket_close", sessionId, code, reason: reason ? String(reason) : "" },
        "info"
      );
    }
    const result = signaling.handleDisconnect(sessionId, sendToSession, onLog);
    applyResult(result);
  }

  ws.on("close", (code, reason) => cleanup(code, reason));
  ws.on("error", (err) => {
    onLog({ type: "websocket_error", sessionId, error: err.message }, "warn");
    cleanup();
  });
});

// WebSocket-level ping/pong (detects dead TCP sockets)
const wsPingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      const deadSessionId = [...sessions.entries()].find(([, w]) => w === ws)?.[0];
      onLog({ type: "ws_ping_timeout", sessionId: deadSessionId || "unknown" }, "warn");
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL_MS);

// Application-level ping (JSON data frames that proxies see as traffic)
const appPingInterval = setInterval(() => {
  const payload = JSON.stringify({ type: "ping", ts: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) {
      try { ws.send(payload); } catch (_) {}
    }
  });
}, APP_PING_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(wsPingInterval);
  clearInterval(appPingInterval);
});

const port = options.port;
let listenLogged = false;
server.listen(port, "0.0.0.0", () => {
  if (!listenLogged) {
    listenLogged = true;
    console.log(`WebRTC signaling server listening on port ${port} (WS /webrtc, dashboard /)`);
  }
});
