// test/gate-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const GATE = resolve("bin/loop-gate.mjs");

async function project() {
  const dir = await mkdtemp(join(tmpdir(), "loopcli-"));
  await mkdir(join(dir, "loops"), { recursive: true });
  await mkdir(join(dir, ".loop"), { recursive: true });
  return dir;
}

function runGate(dir) {
  const out = execFileSync("node", [GATE], {
    input: JSON.stringify({ session_id: "s1", stop_hook_active: false }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("allows stop when there is no active loop", async () => {
  const dir = await project();
  const out = runGate(dir); // no state.json
  assert.deepEqual(out, {});
  await rm(dir, { recursive: true, force: true });
});

test("blocks stop and runs passing checks -> done", async () => {
  const dir = await project();
  await writeFile(join(dir, "loops", "x.loop.md"),
    `---\nmax_iterations: 5\nchecks:\n  - run: "true"\n---\n# Goal\nx\n`);
  await writeFile(join(dir, ".loop", "state.json"), JSON.stringify({
    name: "x", specPath: "loops/x.loop.md", active: true, iteration: 1, evaluations: 0,
    lastCritic: { iteration: 1, verdict: "clean", findings: [] },
    lastChecks: null, stallCount: 0, lastFailSig: null, history: [],
  }));
  const out = runGate(dir);
  assert.deepEqual(out, {}); // done -> allow stop
  await rm(dir, { recursive: true, force: true });
});

test("blocks stop with feedback when a check fails", async () => {
  const dir = await project();
  await writeFile(join(dir, "loops", "x.loop.md"),
    `---\nmax_iterations: 5\nchecks:\n  - run: "false"\n---\n# Goal\nx\n`);
  await writeFile(join(dir, ".loop", "state.json"), JSON.stringify({
    name: "x", specPath: "loops/x.loop.md", active: true, iteration: 1, evaluations: 0,
    lastCritic: { iteration: 1, verdict: "clean", findings: [] },
    lastChecks: null, stallCount: 0, lastFailSig: null, history: [],
  }));
  const out = runGate(dir);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /false/);
  await rm(dir, { recursive: true, force: true });
});
