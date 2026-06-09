# `loop` Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin named `loop` that runs an autonomous build→critique→improve loop inside the engineer's session until a self-authored loop spec's exit conditions are met (independent critic finds no material issues AND automated checks pass) or a guardrail trips.

**Architecture:** A `Stop` hook is the engine. The engineer authors a `loops/<name>.loop.md` spec. `/loop:run` initializes `.loop/state.json` and instructs Claude to build, then dispatch an independent `loop-critic` subagent, then record the critic's verdict into state, then end the turn. The Stop hook calls a dependency-free Node gate (`bin/loop-gate.mjs`) that runs the spec's automated checks, reads the recorded critic verdict, and decides: allow stop (done/capped) or block the stop and feed back what's left (continue). `max_iterations` is a hard floor guaranteeing termination.

**Tech Stack:** Node (ESM, zero runtime dependencies; `node --test` + `node:assert` for tests). Claude Code plugin format (`.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/hooks.json`).

---

## Key contracts (read before any task)

**State file** `${CLAUDE_PROJECT_DIR}/.loop/state.json`:
```json
{
  "name": "<spec name>",
  "specPath": "loops/<name>.loop.md",
  "active": true,
  "iteration": 0,
  "lastCritic": null,
  "lastChecks": null,
  "stallCount": 0,
  "lastFailSig": null,
  "history": []
}
```
- `lastCritic` (written by Claude each round): `{ "iteration": <int>, "verdict": "clean"|"issues", "findings": ["..."] }`
- `lastChecks` (written by the gate): `[ { "run": "...", "ok": true, "errored": false } ]`

**Round ownership:** Claude owns `iteration` (increments it at the start of each round and stamps `lastCritic.iteration` to the same value). The gate validates freshness (`lastCritic.iteration === state.iteration`), runs checks, decides, and owns `active` / `stallCount` / `lastFailSig` / `lastChecks` / `history`.

**Gate decision → hook output mapping (in `bin/loop-gate.mjs`):**
- `allow` / `done` / `cap` / `stall` / `halt` → print `{}` to stdout, exit 0 (Stop is allowed). For non-`allow` terminal actions also set `active=false`.
- `block` → print `{"decision":"block","reason":"<feedback>"}` to stdout, exit 0 (Stop is blocked; `reason` is fed to Claude, who continues).

**Deliberate deviation:** the hook ignores `stop_hook_active` for the keep-going decision. We intentionally re-block across many turns; termination is guaranteed by `max_iterations` and stall detection, not by the default `stop_hook_active` bail-out.

**v1 cap scope:** `max_iterations` (hard) and `stall_after` (real) are enforced. `max_spend_usd` is parsed and surfaced but **not enforced in v1** (reliable in-session spend accounting isn't available to a Stop hook) — the gate logs that it is advisory. This is called out in the README.

**File structure:**
```
loop/
├── .claude-plugin/plugin.json     # manifest
├── package.json                   # {"type":"module"}, test script
├── .gitignore
├── lib/
│   ├── spec.mjs                   # parseSpec(text) -> {caps, checks, critic, onCap, goal, criteria}
│   ├── state.mjs                  # initState / loadState / saveState
│   └── gate.mjs                   # decide({state, spec, checkResults}) -> {action, reason, nextState}
├── bin/
│   └── loop-gate.mjs              # IO wrapper: stdin+env -> run checks -> decide -> stdout
├── hooks/
│   └── hooks.json                 # registers Stop -> node bin/loop-gate.mjs
├── agents/
│   └── loop-critic.md             # adversarial reviewer subagent
├── skills/
│   ├── new/SKILL.md               # /loop:new
│   └── run/SKILL.md               # /loop:run
├── templates/
│   └── loop.template.md           # scaffolded by /loop:new
├── test/
│   ├── spec.test.mjs
│   ├── state.test.mjs
│   ├── gate.test.mjs
│   └── gate-cli.test.mjs
└── README.md
```

---

## Task 1: Repo scaffold (package.json, manifest, gitignore)

**Files:**
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "loop-plugin",
  "version": "1.0.0",
  "description": "Autonomous build-critique loop for Claude Code",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "loop",
  "version": "1.0.0",
  "description": "Author a loop spec, then Claude builds and self-critiques until the feature is delivered — no per-round human prompting.",
  "author": { "name": "chuhaobing" },
  "skills": "./skills/",
  "agents": ["./agents/"],
  "hooks": "./hooks/hooks.json"
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.loop/
```

- [ ] **Step 4: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/plugin.json .gitignore
git commit -m "scaffold loop plugin: package.json, manifest, gitignore"
```

---

## Task 2: Spec parser (`lib/spec.mjs`)

Parses `loops/<name>.loop.md` (YAML-subset frontmatter + markdown body). Zero dependencies.

**Files:**
- Create: `lib/spec.mjs`
- Test: `test/spec.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/spec.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec } from "../lib/spec.mjs";

const SAMPLE = `---
max_iterations: 12
max_spend_usd: 5
stall_after: 3
critic: subagent
on_cap: stop_and_report
checks:
  - run: npm test
  - run: npm run build
---

# Goal
Wire the login page to the real backend API.

# Quality bar
- [ ] Clear error states, no blank screens
- [ ] Responsive at mobile widths
`;

test("parses caps", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.caps.maxIterations, 12);
  assert.equal(s.caps.maxSpendUsd, 5);
  assert.equal(s.caps.stallAfter, 3);
});

test("parses checks as list of {run}", () => {
  const s = parseSpec(SAMPLE);
  assert.deepEqual(s.checks, [{ run: "npm test" }, { run: "npm run build" }]);
});

test("parses critic and onCap", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.critic, "subagent");
  assert.equal(s.onCap, "stop_and_report");
});

test("extracts goal and criteria sections", () => {
  const s = parseSpec(SAMPLE);
  assert.match(s.goal, /login page to the real backend/);
  assert.match(s.criteria, /Responsive at mobile widths/);
});

test("applies defaults when fields omitted", () => {
  const s = parseSpec(`---\nchecks:\n  - run: npm test\n---\n# Goal\nx\n`);
  assert.equal(s.caps.maxIterations, 20);
  assert.equal(s.caps.stallAfter, 3);
  assert.equal(s.caps.maxSpendUsd, null);
  assert.equal(s.critic, "subagent");
  assert.equal(s.onCap, "stop_and_report");
});

test("throws on missing frontmatter", () => {
  assert.throws(() => parseSpec("# Goal\nno frontmatter\n"), /frontmatter/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spec.test.mjs`
Expected: FAIL — `Cannot find module '../lib/spec.mjs'`

- [ ] **Step 3: Write `lib/spec.mjs`**

```js
// lib/spec.mjs
// Minimal, dependency-free parser for the loop spec format:
// YAML-subset frontmatter (scalars + a `checks:` list of `- run: <cmd>`) plus markdown body.

const DEFAULTS = {
  maxIterations: 20,
  maxSpendUsd: null,
  stallAfter: 3,
  critic: "subagent",
  onCap: "stop_and_report",
};

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("Spec is missing YAML frontmatter (--- ... ---).");
  return { fm: m[1], body: m[2] };
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(fm) {
  const lines = fm.split("\n");
  const scalars = {};
  const checks = [];
  let inChecks = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (/^checks:\s*$/.test(line)) { inChecks = true; continue; }
    if (inChecks && /^\s*-\s*run:\s*/.test(line)) {
      checks.push({ run: line.replace(/^\s*-\s*run:\s*/, "").trim() });
      continue;
    }
    if (/^\S/.test(line) && line.includes(":")) {
      inChecks = false;
      const idx = line.indexOf(":");
      scalars[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
    }
  }
  return { scalars, checks };
}

function getSection(body, headingRe) {
  const lines = body.split("\n");
  let capturing = false;
  const out = [];
  for (const line of lines) {
    const h = line.match(/^#\s+(.*)$/);
    if (h) {
      if (capturing) break;
      capturing = headingRe.test(h[1]);
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

export function parseSpec(text) {
  const { fm, body } = splitFrontmatter(text);
  const { scalars, checks } = parseFrontmatter(fm);
  return {
    caps: {
      maxIterations: scalars.max_iterations ?? DEFAULTS.maxIterations,
      maxSpendUsd: scalars.max_spend_usd ?? DEFAULTS.maxSpendUsd,
      stallAfter: scalars.stall_after ?? DEFAULTS.stallAfter,
    },
    checks,
    critic: scalars.critic ?? DEFAULTS.critic,
    onCap: scalars.on_cap ?? DEFAULTS.onCap,
    goal: getSection(body, /goal/i),
    criteria: getSection(body, /quality|done|acceptance|criteria/i),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spec.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/spec.mjs test/spec.test.mjs
git commit -m "feat(spec): zero-dep loop spec parser"
```

---

## Task 3: State helpers (`lib/state.mjs`)

**Files:**
- Create: `lib/state.mjs`
- Test: `test/state.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `Cannot find module '../lib/state.mjs'`

- [ ] **Step 3: Write `lib/state.mjs`**

```js
// lib/state.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function statePath(projectDir) {
  return join(projectDir, ".loop", "state.json");
}

export function initState(name, specPath) {
  return {
    name,
    specPath,
    active: true,
    iteration: 0,
    lastCritic: null,
    lastChecks: null,
    stallCount: 0,
    lastFailSig: null,
    history: [],
  };
}

export function loadState(projectDir) {
  try {
    return JSON.parse(readFileSync(statePath(projectDir), "utf8"));
  } catch {
    return null; // missing or corrupt -> fail safe
  }
}

export function saveState(projectDir, state) {
  mkdirSync(join(projectDir, ".loop"), { recursive: true });
  writeFileSync(statePath(projectDir), JSON.stringify(state, null, 2) + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/state.mjs test/state.test.mjs
git commit -m "feat(state): loop state init/load/save with fail-safe load"
```

---

## Task 4: Decision engine (`lib/gate.mjs`) — the core logic

Pure function. No IO. This is the riskiest unit; test it hard.

**Files:**
- Create: `lib/gate.mjs`
- Test: `test/gate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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

test("cap when iteration reaches max_iterations", () => {
  const st = freshState({ iteration: 5, lastCritic: { iteration: 5, verdict: "issues", findings: ["x"] } });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gate.test.mjs`
Expected: FAIL — `Cannot find module '../lib/gate.mjs'`

- [ ] **Step 3: Write `lib/gate.mjs`**

```js
// lib/gate.mjs
// Pure decision logic. No IO. Assumes an active loop (caller handles "no loop").
// Returns { action, reason, nextState }.
//   action: "done" | "cap" | "stall" | "halt" | "block"
//   "done"|"cap"|"stall"|"halt" => allow the Stop. "block" => block the Stop, feed `reason` to Claude.

function failSignature(checkResults, critic) {
  const failed = checkResults.filter((c) => !c.ok).map((c) => c.run).sort();
  const verdict = critic ? critic.verdict : "none";
  return JSON.stringify({ failed, verdict });
}

function feedback(failingChecks, findings) {
  const parts = [];
  if (failingChecks.length) {
    parts.push("Automated checks still failing:\n" + failingChecks.map((c) => `  - ${c.run}`).join("\n"));
  }
  if (findings && findings.length) {
    parts.push("Critic found unresolved issues:\n" + findings.map((f) => `  - ${f}`).join("\n"));
  }
  parts.push("Address these, increment the round in .loop/state.json, re-run the loop-critic, then end your turn. Do not ask the human for input.");
  return parts.join("\n\n");
}

export function decide({ state, spec, checkResults }) {
  const next = { ...state, lastChecks: checkResults };

  // 1) Config error: a check command errored (e.g. command-not-found).
  const errored = checkResults.filter((c) => c.errored);
  if (errored.length) {
    next.active = false;
    return {
      action: "halt",
      reason: `A check command errored (misconfigured spec): ${errored.map((c) => c.run).join(", ")}. Fix the spec's checks and re-run /loop:run.`,
      nextState: next,
    };
  }

  // 2) Critic must be fresh for the current round, else the round isn't complete.
  if (!state.lastCritic || state.lastCritic.iteration !== state.iteration) {
    return {
      action: "block",
      reason: `Run the loop-critic subagent for round ${state.iteration} and record its verdict in .loop/state.json (lastCritic.iteration must equal ${state.iteration}) before ending your turn.`,
      nextState: next,
    };
  }

  const allPass = checkResults.every((c) => c.ok);
  const criticClean = state.lastCritic.verdict === "clean";
  const failingChecks = checkResults.filter((c) => !c.ok);

  // 3) Done.
  if (allPass && criticClean) {
    next.active = false;
    next.history = [...state.history, { iteration: state.iteration, result: "done" }];
    return {
      action: "done",
      reason: `Delivered in ${state.iteration} iteration(s): all checks pass and the critic found no material issues.`,
      nextState: next,
    };
  }

  // 4) Iteration cap.
  if (state.iteration >= spec.caps.maxIterations) {
    next.active = false;
    return {
      action: "cap",
      reason: `Hit max_iterations (${spec.caps.maxIterations}) before delivering. Stopping (on_cap: ${spec.onCap}). Unresolved: ${failSignature(checkResults, state.lastCritic)}`,
      nextState: next,
    };
  }

  // 5) Stall detection.
  const sig = failSignature(checkResults, state.lastCritic);
  next.stallCount = sig === state.lastFailSig ? state.stallCount + 1 : 1;
  next.lastFailSig = sig;
  if (next.stallCount >= spec.caps.stallAfter) {
    next.active = false;
    return {
      action: "stall",
      reason: `No progress for ${next.stallCount} rounds (same failures). Stopping to avoid burning budget. Unresolved: ${sig}`,
      nextState: next,
    };
  }

  // 6) Otherwise keep going.
  return {
    action: "block",
    reason: feedback(failingChecks, state.lastCritic.findings),
    nextState: next,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gate.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/gate.mjs test/gate.test.mjs
git commit -m "feat(gate): core build-critique loop decision engine"
```

---

## Task 5: Hook IO wrapper (`bin/loop-gate.mjs`)

Wires real IO around the pure pieces: read stdin + env, short-circuit when no active loop, run the spec's checks, call `decide`, persist state, emit hook JSON.

**Files:**
- Create: `bin/loop-gate.mjs`
- Test: `test/gate-cli.test.mjs`

- [ ] **Step 1: Write the failing integration test**

```js
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
    name: "x", specPath: "loops/x.loop.md", active: true, iteration: 1,
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
    name: "x", specPath: "loops/x.loop.md", active: true, iteration: 1,
    lastCritic: { iteration: 1, verdict: "clean", findings: [] },
    lastChecks: null, stallCount: 0, lastFailSig: null, history: [],
  }));
  const out = runGate(dir);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /false/);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gate-cli.test.mjs`
Expected: FAIL — `Cannot find module` / spawn error for `bin/loop-gate.mjs`

- [ ] **Step 3: Write `bin/loop-gate.mjs`**

```js
#!/usr/bin/env node
// bin/loop-gate.mjs
// Stop-hook entry point. Reads hook JSON on stdin, decides whether to allow or
// block the stop, prints hook JSON on stdout, exits 0.
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { parseSpec } from "../lib/spec.mjs";
import { loadState, saveState } from "../lib/state.mjs";
import { decide } from "../lib/gate.mjs";

function readStdin() {
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
  readStdin(); // hook input is read but not required for the decision
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const state = loadState(projectDir);
  if (!state || !state.active) out({}); // no active loop -> never interfere

  let spec;
  try {
    const specAbs = isAbsolute(state.specPath) ? state.specPath : join(projectDir, state.specPath);
    spec = parseSpec(readFileSync(specAbs, "utf8"));
  } catch (e) {
    state.active = false;
    saveState(projectDir, state);
    out({}); // spec unreadable -> fail safe, allow stop
  }

  const checkResults = spec.checks.map((c) => runCheck(c.run, projectDir));
  const { action, reason, nextState } = decide({ state, spec, checkResults });
  saveState(projectDir, nextState);

  if (action === "block") out({ decision: "block", reason });
  // done | cap | stall | halt -> allow the stop, surface the summary
  out({ systemMessage: reason });
}

main();
```

> Note: the `done`/`cap`/`stall`/`halt` branch returns `{ systemMessage }` (no `decision`), which allows the Stop. The CLI test asserts `{}`-equivalence only for the no-loop and done cases — update the done test to assert `out.systemMessage` is present and `out.decision` is undefined if you prefer; both are valid "allow" outputs. To keep the test in Step 1 exactly as written, change the final allow line for the `done` case to `out({})` when `action === "done"`. Implement it as:
>
> ```js
>   if (action === "block") out({ decision: "block", reason });
>   if (action === "done") out({});
>   out({ systemMessage: reason });
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gate-cli.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — all tests across spec/state/gate/gate-cli green.

- [ ] **Step 6: Commit**

```bash
git add bin/loop-gate.mjs test/gate-cli.test.mjs
git commit -m "feat(gate-cli): Stop-hook IO wrapper wiring checks + decide + state"
```

---

## Task 6: Register the Stop hook (`hooks/hooks.json`)

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/loop-gate.mjs\"",
            "timeout": 120,
            "statusMessage": "loop: checking exit conditions"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(hooks): register Stop hook -> loop-gate"
```

---

## Task 7: Critic subagent (`agents/loop-critic.md`)

Independent, adversarial reviewer. Read-only inspection; returns a strict JSON verdict that `/loop:run` parses into `lastCritic`.

**Files:**
- Create: `agents/loop-critic.md`

- [ ] **Step 1: Create `agents/loop-critic.md`**

```markdown
---
name: loop-critic
description: Adversarial reviewer for the loop plugin. Given a goal, acceptance criteria, and a summary of what changed this round, reviews the working tree and reports whether the work materially meets the bar. Returns strict JSON.
tools: Read, Grep, Glob, Bash
---

You are a strict senior reviewer. You did NOT write this code. Your job is to find
what is still wrong or missing — not to be encouraging. Assume the author is biased
toward declaring victory; your default suspicion is that the work is NOT done yet.

You will be given:
- GOAL: what the feature is supposed to accomplish.
- ACCEPTANCE CRITERIA: the quality bar (may include subjective items).
- CHANGED THIS ROUND: a summary of what the author claims to have done.

Steps:
1. Inspect the actual working tree (read the relevant files, run read-only commands
   if useful). Do not trust the summary — verify against the code.
2. Judge against the GOAL and ACCEPTANCE CRITERIA only. Do not invent new scope.
3. List concrete, actionable deficiencies. Each finding must be specific enough to
   act on (file/behavior, not vibes). Omit nitpicks that do not affect meeting the bar.

Output ONLY a single JSON object as the final message, no prose around it:

{
  "verdict": "clean" | "issues",
  "findings": ["<specific actionable issue>", "..."]
}

- "clean" means: every acceptance criterion is genuinely met and you found no
  material defect. Use it sparingly and only when you truly cannot find a real gap.
- "issues" means: at least one criterion is unmet or a material defect exists.
  `findings` must be non-empty.
```

- [ ] **Step 2: Verify frontmatter is well-formed**

Run: `node -e "const t=require('fs').readFileSync('agents/loop-critic.md','utf8'); if(!/^---[\s\S]*?---/.test(t)) throw new Error('bad frontmatter'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add agents/loop-critic.md
git commit -m "feat(critic): independent adversarial reviewer subagent"
```

---

## Task 8: `/loop:new` scaffolder + template

**Files:**
- Create: `templates/loop.template.md`
- Create: `skills/new/SKILL.md`

- [ ] **Step 1: Create `templates/loop.template.md`**

```markdown
---
max_iterations: 15
max_spend_usd: 5
stall_after: 3
critic: subagent
on_cap: stop_and_report
checks:
  - run: npm test
  - run: npm run build
---

# Goal
<Describe the feature to build or polish, in plain language.>

# Quality bar
<What "done" means. Objective items belong in `checks` above; put subjective /
acceptance items here as a checklist for the critic to review against.>
- [ ] <e.g. clear error states, no blank screens>
- [ ] <e.g. responsive at mobile widths>
```

- [ ] **Step 2: Create `skills/new/SKILL.md`**

```markdown
---
name: new
description: Scaffold a new loop spec (loops/<name>.loop.md) by interviewing the engineer for the goal, exit conditions, and guardrails.
argument-hint: "[name]"
---

## Create a loop spec

The user wants to author a new loop spec. The argument (if any) is the loop name:
`$ARGUMENTS`.

1. Decide the name: use `$ARGUMENTS` if provided, else ask for a short kebab-case
   name (e.g. `login-api`).
2. Interview the engineer, ONE question at a time, to fill in:
   - **Goal**: what feature to build/polish.
   - **Automated checks** (`checks`): the shell commands that must exit 0 for this
     to be "done" (tests, build, typecheck, lint, a smoke command). Confirm the
     real commands for THIS repo — look at package.json / Makefile if unsure.
   - **Quality bar**: subjective acceptance criteria the critic will review against.
   - **Guardrails**: max_iterations (hard cap), stall_after, optional max_spend_usd
     (advisory in v1), on_cap (stop_and_report | ask_human).
3. Read `${CLAUDE_PLUGIN_ROOT}/templates/loop.template.md` as the starting shape,
   fill it in with the answers, and write it to `loops/<name>.loop.md` in the repo
   (create the `loops/` directory if needed).
4. Show the engineer the written file and tell them they can edit it by hand, then
   run `/loop:run <name>` to start the loop.

Do not start the loop yourself — `/loop:new` only authors the spec.
```

- [ ] **Step 3: Verify both files parse / exist**

Run: `node -e "['templates/loop.template.md','skills/new/SKILL.md'].forEach(f=>{const t=require('fs').readFileSync(f,'utf8'); if(!/^---[\s\S]*?---/.test(t)) throw new Error('bad frontmatter: '+f)}); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add templates/loop.template.md skills/new/SKILL.md
git commit -m "feat(new): /loop:new spec scaffolder + template"
```

---

## Task 9: `/loop:run` orchestration skill (the loop contract)

This SKILL.md is the prompt that drives the in-session loop. It must establish the round/critic contract the gate validates.

**Files:**
- Create: `skills/run/SKILL.md`

- [ ] **Step 1: Create `skills/run/SKILL.md`**

```markdown
---
name: run
description: Start an autonomous build-critique loop from a loop spec. Claude builds, self-critiques via an independent critic subagent, and iterates until the spec's exit conditions are met or a guardrail trips — without per-round human prompting.
argument-hint: "[name]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent
---

## Run an autonomous loop

Argument (loop name, optional): `$ARGUMENTS`

### Setup (once)
1. Resolve the spec:
   - If `$ARGUMENTS` is given, use `loops/$ARGUMENTS.loop.md`.
   - Else if exactly one `loops/*.loop.md` exists, use it.
   - Else list the specs and ask which one. If none exist, tell the user to run
     `/loop:new` first and stop.
2. Read the spec. Restate to the user: the Goal, the automated `checks`, the quality
   bar, and the guardrails (max_iterations, stall_after, on_cap). Note that
   `max_spend_usd` is advisory in v1.
3. Initialize `.loop/state.json` in the project root (create `.loop/` if needed):
   ```json
   { "name": "<name>", "specPath": "loops/<name>.loop.md", "active": true,
     "iteration": 0, "lastCritic": null, "lastChecks": null,
     "stallCount": 0, "lastFailSig": null, "history": [] }
   ```

### The loop (each round)
You will keep working in rounds. After each of your turns, the loop's Stop hook runs
the spec's automated checks and reads your recorded critic verdict, then either tells
you to continue (with specific feedback) or ends the loop. **Do not ask the human for
feedback between rounds** — the critic plays the reviewer role.

Each round, do ALL of the following before ending your turn:
1. Read `.loop/state.json`. Set `iteration = iteration + 1` and write it back.
2. Do the work: build or improve the feature toward the Goal. On the first round,
   start implementing. On later rounds, address the feedback the hook gave you
   (failing checks and/or critic findings).
3. Dispatch the **`loop-critic`** subagent (use the Agent tool with
   `subagent_type: "loop-critic"`). Pass it: the GOAL, the ACCEPTANCE CRITERIA (the
   spec's quality bar), and a short CHANGED THIS ROUND summary of what you just did.
   It returns strict JSON: `{ "verdict": "clean"|"issues", "findings": [...] }`.
4. Record the verdict into `.loop/state.json` as:
   `"lastCritic": { "iteration": <current iteration>, "verdict": <verdict>, "findings": <findings> }`
   (`lastCritic.iteration` MUST equal the current `iteration`, or the hook will send
   you back to run the critic.)
5. End your turn.

### Ending
The hook ends the loop when checks pass AND the critic is clean (delivered), or when a
guardrail trips (max_iterations / stall / misconfigured check). When you see the hook's
completion message, summarize for the user: iterations used, final check status, and the
critic's last verdict. The hook sets `active: false`; do not re-run unless the user asks.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `node -e "const t=require('fs').readFileSync('skills/run/SKILL.md','utf8'); if(!/^---[\s\S]*?---/.test(t)) throw new Error('bad frontmatter'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add skills/run/SKILL.md
git commit -m "feat(run): /loop:run autonomous build-critique orchestration"
```

---

## Task 10: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# loop

A Claude Code plugin for **writing loops, not prompts.** Author a loop spec that says
what you want and when it's done; run one command; Claude builds and self-critiques in
a tight loop until the feature meets the bar — no per-round human prompting.

## How it works

1. `/loop:new <name>` interviews you and writes `loops/<name>.loop.md`.
2. You edit the spec: the **Goal**, the automated **checks** (commands that must pass),
   the **quality bar** (what the critic reviews against), and **guardrails**.
3. `/loop:run <name>` starts the loop. Each round Claude builds, then an independent
   `loop-critic` subagent adversarially reviews the work. A `Stop` hook runs the checks
   and reads the critic's verdict, then either feeds back what's left (continue) or ends
   the loop (delivered / capped).

## The spec

```markdown
---
max_iterations: 15        # hard cap — guarantees the loop stops
max_spend_usd: 5          # advisory only in v1 (not enforced)
stall_after: 3            # same failures N rounds in a row -> stop
critic: subagent
on_cap: stop_and_report   # or ask_human
checks:
  - run: npm test
  - run: npm run build
---

# Goal
<what to build/polish>

# Quality bar
- [ ] <subjective acceptance criteria the critic checks>
```

## Guardrails

- **`max_iterations`** is a hard floor — the loop always terminates. `Esc` aborts anytime.
- **Stall detection** stops the loop if the same failures repeat `stall_after` rounds.
- A check command that **errors** (e.g. command-not-found) halts with a config error
  instead of burning iterations.
- **`max_spend_usd` is advisory in v1** — reliable in-session spend accounting isn't
  available to a Stop hook. Use `max_iterations` to bound cost.

## State

`.loop/state.json` (gitignored) tracks the active loop: iteration, last checks, last
critic verdict, stall counter. Delete it (or let the hook set `active:false`) to reset.

## Develop

```bash
npm test   # runs lib + cli tests with node --test
```
````

- [ ] **Step 2: Run the full test suite one last time**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 3: Sanity-check the plugin loads (optional, manual)**

In a Claude Code session, add this directory as a plugin (or symlink into your plugins
dir) and confirm `/loop:new` and `/loop:run` appear. This is a manual smoke check.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README for loop plugin"
```

---

## Manual end-to-end test (after implementation)

1. In a throwaway repo with a trivial failing feature (e.g. a function with a failing
   test), run `/loop:new demo`, set `checks: [{run: "npm test"}]` and a simple goal.
2. Run `/loop:run demo`.
3. Confirm: Claude implements, dispatches `loop-critic`, records the verdict, and the
   Stop hook either blocks with feedback (and Claude continues automatically, no human
   prompt) or ends with a delivered summary once `npm test` passes and the critic is clean.
4. Confirm `max_iterations` halts a deliberately-unsatisfiable goal.

---

## Self-review notes

- **Spec coverage:** spec format (Task 2, 8), state (Task 3), build→critique→improve
  loop (Task 4 decide + Task 9 run contract + Task 7 critic), Stop-hook engine (Task 5,
  6), `/loop:new` + `/loop:run` (Task 8, 9), guardrails — max_iterations/stall/config-
  error (Task 4), fail-safe state (Task 3, 5), packaging (Task 1), README (Task 10). ✅
- **Deviation from spec:** `max_spend_usd` is parsed but **not enforced in v1** (Stop
  hooks lack reliable spend data). Documented in plan header + README. Flag to user.
- **Critic mechanism:** independent subagent per round (spec-approved), enforced via the
  `lastCritic.iteration === iteration` freshness gate to prevent early exit.
````
