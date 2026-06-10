// test/state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initState, loadState, saveState, statePath } from "../lib/state.mjs";

async function tmp() { return mkdtemp(join(tmpdir(), "loop-")); }

test("initState shape", () => {
  const s = initState("login", "loops/login.loop.md");
  assert.equal(s.name, "login");
  assert.equal(s.specPath, "loops/login.loop.md");
  assert.equal(s.active, true);
  assert.equal(s.iteration, 0);
  assert.equal(s.lastCritic, null);
  assert.equal(s.stallCount, 0);
  assert.deepEqual(s.history, []);
});

test("save then load round-trips", async () => {
  const dir = await tmp();
  const s = initState("x", "loops/x.loop.md");
  saveState(dir, s);
  assert.deepEqual(loadState(dir), s);
  assert.equal(statePath(dir), join(dir, ".loop", "state.json"));
  await rm(dir, { recursive: true, force: true });
});

test("loadState returns null when missing", async () => {
  const dir = await tmp();
  assert.equal(loadState(dir), null);
  await rm(dir, { recursive: true, force: true });
});

test("loadState returns null on corrupt json (fail safe)", async () => {
  const dir = await tmp();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(dir, ".loop"));
  writeFileSync(join(dir, ".loop", "state.json"), "{ not json");
  assert.equal(loadState(dir), null);
  await rm(dir, { recursive: true, force: true });
});

test("initState includes criteriaCount 0", () => {
  const s = initState("x", "loops/x.loop.md");
  assert.equal(s.criteriaCount, 0);
});
