/**
 * Direct-Calling Signaling Router (standalone)
 * Matches the Node-RED WebSocket function node protocol.
 *
 * Data structures:
 * - clients: { clientId: sessionId } - Maps device ID to WebSocket session
 * - sessInfo: { sessionId: { clientId, displayName, lastActivity, inCallWith } }
 *
 * Protocol messages:
 * - register: Client registers with server
 * - registered: Server confirms registration
 * - offer/answer/candidate: WebRTC signaling (routed by 'to' field)
 * - hangup: End call
 * - unavailable: Target device not online
 * - getClients: Request client list
 * - clientsList: List of online clients (registered and recently active)
 * - heartbeat: Keep-alive (avoids being pruned as stale)
 *
 * Stale cleanup: Clients with no activity for STALE_CLIENT_MS are pruned before
 * each clientsList broadcast, so devices that disconnect without a proper close
 * do not stay in the list. Pruned sockets are terminated server-side (avoids zombies).
 */

/** Max idle time (ms) before a client is considered offline and pruned from the list. */
const STALE_CLIENT_MS = 90000;

/**
 * @param {{ terminateSession?: (sessionId: string) => void }} [options]
 */
function createSignaling(options = {}) {
  const terminateSession = typeof options.terminateSession === "function" ? options.terminateSession : () => {};

  const clients = {};
  const sessInfo = {};

  function pruneStaleClients() {
    const now = Date.now();
    let pruned = false;
    for (const sid of Object.keys(sessInfo)) {
      const info = sessInfo[sid];
      if (!info || (now - (info.lastActivity || 0)) > STALE_CLIENT_MS) {
        if (info) {
          const cid = info.clientId;
          if (cid && clients[cid] === sid) delete clients[cid];
          pruned = true;
        }
        terminateSession(sid);
        delete sessInfo[sid];
        pruned = true;
      }
    }
    return pruned;
  }

  function buildClientsList() {
    pruneStaleClients();
    return Object.keys(clients).map((cid) => {
      const sid = clients[cid];
      const info = sessInfo[sid] || {};
      return {
        clientId: cid,
        displayName: info.displayName ?? null,
        inCall: !!info.inCallWith,
        inCallWith: info.inCallWith ?? null,
        lastActivity: info.lastActivity ?? null,
      };
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} data - Parsed message from client
   * @param {function(string, object): void} sendToSession - sendToSession(targetSessionId, obj)
   * @param {function(string, object, number): void} scheduleSend - scheduleSend(sessionId, obj, delayMs)
   * @param {function(object, string): void} [onLog] - onLog(payload, level) for OpenObserve
   * @returns {{ sends?: Array<{ sessionId: string, payload: object }>, scheduled?: Array<{ sessionId: string, payload: object, delayMs: number }> }}
   */
  function handleMessage(sessionId, data, sendToSession, scheduleSend, onLog) {
    const noop = () => {};
    onLog = onLog || noop;

    if (!data || !data.type) return {};

    if (data.type === "register") {
      const clientId = String(data.clientId || "").trim();
      const displayName = data.displayName ?? null;

      if (!clientId) {
        sendToSession(sessionId, { type: "error", message: "missing_client_id" });
        return {};
      }

      const oldSessId = clients[clientId];

      clients[clientId] = sessionId;
      sessInfo[sessionId] = {
        clientId,
        displayName,
        lastActivity: Date.now(),
        inCallWith: null,
      };

      const registeredPayload = { type: "registered", clientId };
      const sends = [{ sessionId, payload: registeredPayload }];
      const scheduled = [
        { sessionId, payload: registeredPayload, delayMs: 100 },
        { sessionId, payload: registeredPayload, delayMs: 250 },
      ];

      onLog({ type: "registered", clientId, displayName: displayName || undefined }, "info");

      if (oldSessId && oldSessId !== sessionId) {
        sendToSession(oldSessId, { type: "replaced", bySession: sessionId });
        terminateSession(oldSessId);
        delete sessInfo[oldSessId];
      }

      const clientsList = buildClientsList();
      const listPayload = { type: "clientsList", clients: clientsList.map((c) => ({ clientId: c.clientId, displayName: c.displayName, inCall: c.inCall })) };
      for (const sid of Object.values(clients)) {
        sends.push({ sessionId: sid, payload: listPayload });
      }
      onLog({ type: "clientsList", count: clientsList.length }, "info");

      return { sends, scheduled };
    }

    const info = sessInfo[sessionId];
    if (!info) {
      sendToSession(sessionId, { type: "error", message: "not_registered" });
      onLog({ type: "error", message: "not_registered", sessionId }, "warn");
      return {};
    }

    const fromClientId = info.clientId;
    info.lastActivity = Date.now();

    function routeTo(targetClientId, obj, from) {
      const targetSessId = clients[targetClientId];
      if (targetSessId) {
        obj.from = from;
        sendToSession(targetSessId, obj);
        return true;
      }
      if (clients[from]) {
        sendToSession(clients[from], { type: "unavailable", targetId: targetClientId, reason: "offline" });
      }
      return false;
    }

    if (data.type === "offer") {
      const to = data.to;
      if (!to) {
        sendToSession(sessionId, { type: "error", message: "missing_to_field" });
        return {};
      }
      info.inCallWith = to;
      const targetSessId = clients[to];
      if (targetSessId && sessInfo[targetSessId]) sessInfo[targetSessId].inCallWith = fromClientId;
      routeTo(to, { type: "offer", sdp: data.sdp, to }, fromClientId);
      return {};
    }

    if (data.type === "answer") {
      routeTo(data.to, { type: "answer", sdp: data.sdp, to: data.to }, fromClientId);
      return {};
    }

    if (data.type === "candidate") {
      routeTo(data.to, {
        type: "candidate",
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
        to: data.to,
      }, fromClientId);
      return {};
    }

    if (data.type === "hangup") {
      const to = data.to || info.inCallWith;
      if (to) {
        routeTo(to, { type: "hangup", to }, fromClientId);
        const targetSessId = clients[to];
        if (targetSessId && sessInfo[targetSessId]) sessInfo[targetSessId].inCallWith = null;
        info.inCallWith = null;
      }
      return {};
    }

    if (data.type === "getClients") {
      const clientsList = buildClientsList();
      const listPayload = { type: "clientsList", clients: clientsList.map((c) => ({ clientId: c.clientId, displayName: c.displayName, inCall: c.inCall })) };
      const sends = [];
      for (const sid of Object.values(clients)) {
        sends.push({ sessionId: sid, payload: listPayload });
      }
      onLog({ type: "clientsList", count: clientsList.length }, "info");
      return { sends };
    }

    if (data.type === "heartbeat") {
      onLog({ type: "heartbeat", clientId: fromClientId }, "debug");
      return {};
    }

    if (data.type === "pong") {
      return {};
    }

    onLog({ type: "unknown_message", messageType: data.type }, "debug");
    return {};
  }

  /**
   * @param {string} sessionId
   * @param {function(string, object): void} sendToSession
   * @param {function(object, string): void} [onLog]
   * @returns {{ sends?: Array<{ sessionId: string, payload: object }> }}
   */
  function handleDisconnect(sessionId, sendToSession, onLog) {
    const noop = () => {};
    onLog = onLog || noop;

    const info = sessInfo[sessionId];
    if (!info) return {};

    const clientId = info.clientId;

    const sends = [];
    if (info.inCallWith) {
      const peerSessId = clients[info.inCallWith];
      if (peerSessId) {
        sends.push({ sessionId: peerSessId, payload: { type: "hangup", from: clientId } });
        if (sessInfo[peerSessId]) sessInfo[peerSessId].inCallWith = null;
      }
    }

    // Only remove from clients if this session is still the one registered (same device may have reconnected with a new session).
    if (clients[clientId] === sessionId) {
      delete clients[clientId];
    }
    delete sessInfo[sessionId];
    onLog({ type: "disconnect", clientId }, "info");

    const clientsList = buildClientsList();
    const listPayload = { type: "clientsList", clients: clientsList.map((c) => ({ clientId: c.clientId, displayName: c.displayName, inCall: c.inCall })) };
    for (const sid of Object.values(clients)) {
      sends.push({ sessionId: sid, payload: listPayload });
    }

    return { sends };
  }

  function getState() {
    return { clients: buildClientsList() };
  }

  return { handleMessage, handleDisconnect, getState };
}

module.exports = { createSignaling, STALE_CLIENT_MS };
