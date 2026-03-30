"use strict";

/**
 * Asserts terminateSession is invoked on same-client re-register and on stale prune
 * (parity with Node-RED tryCloseWebSocketSession). Run: node verify-terminate-parity.test.js
 */

const assert = require("assert");
const { createSignaling, STALE_CLIENT_MS } = require("./signaling.js");

function testEviction() {
  const terminated = [];
  const signaling = createSignaling({
    terminateSession: (id) => terminated.push(id),
  });
  function sendToSession() {}
  signaling.handleMessage("s1", { type: "register", clientId: "c1" }, sendToSession, () => {}, () => {});
  signaling.handleMessage("s2", { type: "register", clientId: "c1" }, sendToSession, () => {}, () => {});
  assert.deepStrictEqual(terminated, ["s1"], "old session should be terminated on re-register");
}

function testStalePrune() {
  const terminated = [];
  const signaling = createSignaling({
    terminateSession: (id) => terminated.push(id),
  });
  const realNow = Date.now;
  let mockT = 1_000_000_000_000;
  Date.now = () => mockT;
  try {
    function sendToSession() {}
    signaling.handleMessage("old", { type: "register", clientId: "a" }, sendToSession, () => {}, () => {});
    mockT += STALE_CLIENT_MS + 1000;
    signaling.handleMessage("new", { type: "register", clientId: "b" }, sendToSession, () => {}, () => {});
    assert.ok(terminated.includes("old"), "stale session should be terminated when pruned");
  } finally {
    Date.now = realNow;
  }
}

function testPongHandled() {
  const signaling = createSignaling({});
  function sendToSession() {}
  signaling.handleMessage("s1", { type: "register", clientId: "c1" }, sendToSession, () => {}, () => {});
  const result = signaling.handleMessage("s1", { type: "pong" }, sendToSession, () => {}, () => {});
  assert.deepStrictEqual(result, {}, "pong should be handled silently (no sends, no error)");
  const state = signaling.getState();
  assert.strictEqual(state.clients.length, 1, "client should still be registered after pong");
  assert.strictEqual(state.clients[0].clientId, "c1");
}

function testPingFromUnregisteredReturnsError() {
  const signaling = createSignaling({});
  const sent = [];
  function sendToSession(sid, obj) { sent.push({ sid, obj }); }
  signaling.handleMessage("unknown-session", { type: "pong" }, sendToSession, () => {}, () => {});
  assert.ok(
    sent.some((s) => s.obj.type === "error" && s.obj.message === "not_registered"),
    "unregistered session sending pong should get not_registered error"
  );
}

testEviction();
testStalePrune();
testPongHandled();
testPingFromUnregisteredReturnsError();
console.log("verify-terminate-parity: ok (4 tests)");
