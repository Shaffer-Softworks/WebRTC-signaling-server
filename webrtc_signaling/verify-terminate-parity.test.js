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

testEviction();
testStalePrune();
console.log("verify-terminate-parity: ok");
