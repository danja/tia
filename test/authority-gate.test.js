/**
 * Dual-gate tests: capability + hybrid human record.
 * Run: node --test test/authority-gate.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  issue,
  check,
  clearCaps,
  mayAct,
  consume,
  clearSpent,
  invokeWithDualGate
} from "../src/harness/index.js";

function futureTtl(hours = 1) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function pastTtl() {
  return new Date(Date.now() - 3600 * 1000).toISOString();
}

function decision(overrides = {}) {
  return {
    kind: "DECISION",
    ttl: futureTtl(),
    payload: {
      proposal_hash: "prop-1",
      outcome: "AUTHORIZED",
      authorized_by: "human-owner",
      what_was_seen: { summary: "reviewed tool call" },
      ...overrides.payload
    },
    ...overrides
  };
}

describe("caps attenuation", () => {
  beforeEach(() => {
    clearCaps();
    clearSpent();
  });

  it("issues and checks a cap", () => {
    const cap = issue({
      resource: "tool:echo",
      actions: ["invoke"],
      taskId: "task-a",
      ttlSeconds: 60
    });
    assert.equal(check(cap.id, "tool:echo", "invoke", "task-a"), true);
    assert.equal(check(cap.id, "tool:echo", "invoke", "task-b"), false);
    assert.equal(check(cap.id, "tool:other", "invoke", "task-a"), false);
  });

  it("rejects widening attenuation", () => {
    const parent = issue({
      resource: "tool:db",
      actions: ["invoke"],
      taskId: "t1",
      ttlSeconds: 60
    });
    assert.throws(() =>
      issue({
        resource: "tool:db",
        actions: ["invoke", "admin"],
        taskId: "t1",
        ttlSeconds: 60,
        parent
      })
    );
  });
});

describe("hybrid mayAct/consume", () => {
  beforeEach(() => {
    clearSpent();
  });

  it("passes with human record", () => {
    const d = decision();
    assert.equal(mayAct(d, "prop-1"), true);
  });

  it("holds without authorized_by", () => {
    const d = decision({ payload: { authorized_by: "", proposal_hash: "prop-1", outcome: "AUTHORIZED", what_was_seen: { x: 1 } } });
    assert.equal(mayAct(d, "prop-1"), false);
  });

  it("holds with empty what_was_seen", () => {
    const d = decision({ payload: { authorized_by: "h", proposal_hash: "prop-1", outcome: "AUTHORIZED", what_was_seen: {} } });
    assert.equal(mayAct(d, "prop-1"), false);
  });

  it("holds when ttl past", () => {
    const d = decision({ ttl: pastTtl() });
    assert.equal(mayAct(d, "prop-1"), false);
  });

  it("consume is single-use", () => {
    const d = decision();
    assert.equal(consume(d, "prop-1"), true);
    assert.equal(mayAct(d, "prop-1"), false);
    assert.equal(consume(d, "prop-1"), false);
  });
});

describe("dual gate invoke", () => {
  beforeEach(() => {
    clearCaps();
    clearSpent();
  });

  it("holds without capability", async () => {
    const r = await invokeWithDualGate({
      toolName: "echo",
      capId: "missing",
      taskId: "t1",
      proposalHash: "prop-1",
      decision: decision(),
      execute: async () => ({ ok: true })
    });
    assert.equal(r.status, "hold");
    assert.match(r.reason, /capability/i);
  });

  it("holds with cap but no human record", async () => {
    const cap = issue({
      resource: "tool:echo",
      actions: ["invoke"],
      taskId: "t1",
      ttlSeconds: 60
    });
    const r = await invokeWithDualGate({
      toolName: "echo",
      capId: cap.id,
      taskId: "t1",
      proposalHash: "prop-1",
      decision: decision({
        payload: {
          proposal_hash: "prop-1",
          outcome: "AUTHORIZED",
          authorized_by: "",
          what_was_seen: { x: 1 }
        }
      }),
      execute: async () => ({ ok: true })
    });
    assert.equal(r.status, "hold");
    assert.match(r.reason, /hybrid|authorized/i);
  });

  it("executes once when both gates pass", async () => {
    const cap = issue({
      resource: "tool:echo",
      actions: ["invoke"],
      taskId: "t1",
      ttlSeconds: 60
    });
    let calls = 0;
    const d = decision();
    const r1 = await invokeWithDualGate({
      toolName: "echo",
      capId: cap.id,
      taskId: "t1",
      proposalHash: "prop-1",
      decision: d,
      execute: async () => {
        calls += 1;
        return { echoed: true };
      }
    });
    assert.equal(r1.status, "ok");
    assert.equal(calls, 1);

    const r2 = await invokeWithDualGate({
      toolName: "echo",
      capId: cap.id,
      taskId: "t1",
      proposalHash: "prop-1",
      decision: d,
      execute: async () => {
        calls += 1;
        return { echoed: true };
      }
    });
    assert.equal(r2.status, "hold");
    assert.equal(calls, 1);
  });
});
