// test/gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/gate.mjs";

const spec = {
  caps: { maxIterations: 5, maxSpendUsd: null, stallAfter: 3 },
  checks: [{ run: "npm test" }, { run: "npm run build" }],
  critic: "subagent",
  onCap: "stop_and_report",
};

// state where Claude finished round 1 and recorded a fresh critic verdict
function freshState(over = {}) {
  return {
    name: "x", specPath: "loops/x.loop.md", active: true, iteration: 1,
    lastCritic: { iteration: 1, verdict: "clean", findings: [] },
    lastChecks: null, stallCount: 0, lastFailSig: null, history: [], ...over,
  };
}
const pass = [{ run: "npm test", ok: true, errored: false }, { run: "npm run build", ok: true, errored: false }];
const fail = [{ run: "npm test", ok: false, errored: false }, { run: "npm run build", ok: true, errored: false }];

test("done when checks pass and critic clean", () => {
  const r = decide({ state: freshState(), spec, checkResults: pass });
  assert.equal(r.action, "done");
  assert.equal(r.nextState.active, false);
});

test("block when a check fails", () => {
  const r = decide({ state: freshState(), spec, checkResults: fail });
  assert.equal(r.action, "block");
  assert.match(r.reason, /npm test/);
  assert.equal(r.nextState.active, true);
});

test("block when critic reports issues even if checks pass", () => {
  const st = freshState({ lastCritic: { iteration: 1, verdict: "issues", findings: ["no error state on 500"] } });
  const r = decide({ state: st, spec, checkResults: pass });
  assert.equal(r.action, "block");
  assert.match(r.reason, /no error state on 500/);
});

test("block (not done) when critic verdict is stale for this round", () => {
  const st = freshState({ iteration: 2, lastCritic: { iteration: 1, verdict: "clean", findings: [] } });
  const r = decide({ state: st, spec, checkResults: pass });
  assert.equal(r.action, "block");
  assert.match(r.reason, /critic/i);
});

test("cap when gate evaluations reach max_iterations (hard floor)", () => {
  const st = freshState({ evaluations: 4, iteration: 5, lastCritic: { iteration: 5, verdict: "issues", findings: ["x"] } });
  const r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.action, "cap");
  assert.equal(r.nextState.active, false);
  assert.match(r.reason, /max_iterations/);
});

test("stall when same failure repeats stall_after times", () => {
  // round 1 fails -> stallCount 1
  let st = freshState({ lastCritic: { iteration: 1, verdict: "issues", findings: ["x"] } });
  let r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.action, "block");
  assert.equal(r.nextState.stallCount, 1);
  // round 2 same failure -> 2
  st = { ...r.nextState, iteration: 2, lastCritic: { iteration: 2, verdict: "issues", findings: ["x"] } };
  r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.nextState.stallCount, 2);
  // round 3 same failure -> hits stall_after (3) -> stall
  st = { ...r.nextState, iteration: 3, lastCritic: { iteration: 3, verdict: "issues", findings: ["x"] } };
  r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.action, "stall");
  assert.equal(r.nextState.active, false);
});

test("stall counter resets when failure signature changes", () => {
  let st = freshState({ stallCount: 2, lastFailSig: "old", lastCritic: { iteration: 1, verdict: "issues", findings: ["x"] } });
  const r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.nextState.stallCount, 1);
});

test("halt when a check command errored (misconfig)", () => {
  const errored = [{ run: "npm test", ok: false, errored: true }];
  const r = decide({ state: freshState(), spec, checkResults: errored });
  assert.equal(r.action, "halt");
  assert.equal(r.nextState.active, false);
  assert.match(r.reason, /errored|misconfig/i);
});

test("cap fires even when the critic is stale (hard floor cannot be bypassed)", () => {
  const st = freshState({ evaluations: 4, iteration: 9, lastCritic: { iteration: 1, verdict: "clean", findings: [] } });
  const r = decide({ state: st, spec, checkResults: fail });
  assert.equal(r.action, "cap");
  assert.equal(r.nextState.active, false);
});

test("done wins over cap at the boundary (delivery beats hard floor)", () => {
  const st = freshState({ evaluations: 4, iteration: 5, lastCritic: { iteration: 5, verdict: "clean", findings: [] } });
  const r = decide({ state: st, spec, checkResults: pass });
  assert.equal(r.action, "done");
});

test("block reason is informative when critic issues has no findings field", () => {
  const st = freshState({ lastCritic: { iteration: 1, verdict: "issues" } }); // no findings key
  const r = decide({ state: st, spec, checkResults: pass });
  assert.equal(r.action, "block");
  assert.match(r.reason, /re-run the loop-critic|no specific findings/i);
});
