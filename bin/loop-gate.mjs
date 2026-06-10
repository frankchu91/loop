#!/usr/bin/env node
// bin/loop-gate.mjs
// Stop-hook entry point. Reads hook JSON on stdin, decides whether to allow or
// block the stop, prints hook JSON on stdout, exits 0. Fail-safe: on ANY error it
// emits {} (allow the stop) so it can never trap the user or exit non-zero silently.
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { parseSpec } from "../lib/spec.mjs";
import { loadState, saveState } from "../lib/state.mjs";
import { decide } from "../lib/gate.mjs";

function readHookInput() {
  // The Stop hook pipes JSON on stdin. We don't need its contents, but must not hang
  // if invoked without a pipe (e.g. a TTY during manual debugging).
  if (process.stdin.isTTY) return "";
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function runCheck(run, cwd) {
  try {
    execSync(run, { cwd, stdio: "ignore", shell: true });
    return { run, ok: true, errored: false };
  } catch (e) {
    // 127 = command not found -> misconfiguration; other non-zero = legit failure.
    const errored = e && e.status === 127;
    return { run, ok: false, errored };
  }
}

function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

function main() {
  readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const state = loadState(projectDir);
  if (!state || !state.active) out({}); // no active loop -> never interfere

  let spec;
  try {
    const specAbs = isAbsolute(state.specPath) ? state.specPath : join(projectDir, state.specPath);
    spec = parseSpec(readFileSync(specAbs, "utf8"));
  } catch {
    state.active = false;
    saveState(projectDir, state);
    out({}); // spec unreadable -> fail safe, allow stop
    return;
  }

  const checkResults = spec.checks.map((c) => runCheck(c.run, projectDir));
  const { action, reason, nextState } = decide({ state, spec, checkResults });
  saveState(projectDir, nextState);

  if (action === "block") out({ decision: "block", reason });
  if (action === "done") out({});
  out({ systemMessage: reason });
}

try {
  main();
} catch {
  // Fail safe: never trap the user or exit non-zero with no decision.
  out({});
}
