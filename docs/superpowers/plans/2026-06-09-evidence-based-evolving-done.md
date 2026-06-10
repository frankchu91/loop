# Evidence-based, Self-evolving "Done" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loop's "done" evidence-based and self-tightening: the `loop-critic` must actually run the product and judge it across four dimensions (works / complete / quality / UX), and the spec's quality bar self-evolves ratchet-only (criteria can only be added, never removed, enforced in the gate).

**Architecture:** Three small code changes (a `criteriaCount` on the parsed spec, a `criteriaCount` field in state, and a ratchet guard in the pure `decide()` gate) plus four prompt/content rewrites (the critic agent, the `/loop:run` contract, `/loop:new`, and the spec template). The gate enforces "only added" via a monotonic count guard; the critic enforces "actually works" by running the product and returning `{verdict, findings, newCriteria}`; `/loop:run` appends `newCriteria` append-only into a marked auto-section of `loops/<name>.loop.md`.

**Tech Stack:** Node (ESM, zero deps, `node --test`). Claude Code plugin skills/agents (markdown).

---

## Context for all tasks

- Node v23: run a single test file with `node --test test/<file>.test.mjs`; run the whole suite with `npm test`.
- The spec parser's `getSection` (`lib/spec.mjs:49`) breaks only on `# ` (H1) headings, so an `## ...` (H2) subsection placed under `# Quality bar` stays part of the criteria text. The self-evolution writes auto-criteria into such an H2 subsection.
- `decide()` (`lib/gate.mjs:33`) currently does, in order: errored→halt, done, cap, iteration<1→block, stale-critic→block, stall, block. The ratchet guard inserts immediately after the errored→halt block.
- Critic verdict contract: the gate's `done` requires `state.lastCritic.verdict === "clean"`. We keep that; the critic simply becomes far stricter about when it says `clean`, and gains a `newCriteria` field that `/loop:run` consumes.

---

## Task 1: `criteriaCount` on the parsed spec (`lib/spec.mjs`)

**Files:**
- Modify: `lib/spec.mjs`
- Test: `test/spec.test.mjs`

- [ ] **Step 1: Write the failing tests** — append to `test/spec.test.mjs`:

```js
test("counts acceptance criteria checkboxes", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.criteriaCount, 2);
});

test("criteriaCount is 0 when the quality bar has no checkboxes", () => {
  const s = parseSpec(`---\nchecks:\n  - run: x\n---\n# Goal\ng\n# Quality bar\nprose only, no boxes\n`);
  assert.equal(s.criteriaCount, 0);
});

test("criteriaCount includes checkboxes in an H2 auto subsection", () => {
  const text = `---\nchecks:\n  - run: x\n---\n# Goal\ng\n# Quality bar\n- [ ] human one\n\n## Discovered criteria (auto)\n- [ ] auto one\n- [x] auto two\n`;
  const s = parseSpec(text);
  assert.equal(s.criteriaCount, 3);
});
```

(`SAMPLE` already exists in this file and has exactly two `- [ ]` items in its `# Quality bar`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/spec.test.mjs`
Expected: FAIL — `criteriaCount` is `undefined`.

- [ ] **Step 3: Implement** — in `lib/spec.mjs`, change the end of `parseSpec` so the criteria text is captured once and counted. Replace this current block:

```js
    goal: getSection(body, /goal/i),
    criteria: getSection(body, /quality|done|acceptance|criteria/i),
  };
}
```

with:

```js
    goal: getSection(body, /goal/i),
    criteria,
    criteriaCount: (criteria.match(/^\s*-\s*\[[ xX]\]/gm) || []).length,
  };
}
```

and, immediately before the `return {` inside `parseSpec`, add:

```js
  const criteria = getSection(body, /quality|done|acceptance|criteria/i);
```

(So `criteria` is computed once, used for both the `criteria` field and `criteriaCount`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/spec.test.mjs`
Expected: PASS (all spec tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/spec.mjs test/spec.test.mjs
git commit -m "feat(spec): expose criteriaCount (checkbox count in the quality bar)"
```

---

## Task 2: `criteriaCount` in initial state (`lib/state.mjs`)

**Files:**
- Modify: `lib/state.mjs`
- Test: `test/state.test.mjs`

- [ ] **Step 1: Write the failing test** — append to `test/state.test.mjs`:

```js
test("initState includes criteriaCount 0", () => {
  const s = initState("x", "loops/x.loop.md");
  assert.equal(s.criteriaCount, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.mjs`
Expected: FAIL — `criteriaCount` is `undefined`.

- [ ] **Step 3: Implement** — in `lib/state.mjs`, add `criteriaCount: 0,` to the object returned by `initState`, immediately after the `evaluations: 0,` line:

```js
    iteration: 0,
    evaluations: 0,
    criteriaCount: 0,
    lastCritic: null,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.mjs`
Expected: PASS (all state tests).

- [ ] **Step 5: Commit**

```bash
git add lib/state.mjs test/state.test.mjs
git commit -m "feat(state): track criteriaCount for the ratchet guard"
```

---

## Task 3: Ratchet guard in the gate (`lib/gate.mjs`)

The criteria count may only stay the same or grow. If a spec's count drops below what state recorded, that's a ratchet violation → `halt`.

**Files:**
- Modify: `lib/gate.mjs`
- Test: `test/gate.test.mjs`

- [ ] **Step 1: Write the failing tests** — append to `test/gate.test.mjs`:

```js
test("halt when criteria count drops below recorded (ratchet violation)", () => {
  const st = freshState({ criteriaCount: 5 });
  const r = decide({ state: st, spec: { ...spec, criteriaCount: 3 }, checkResults: pass });
  assert.equal(r.action, "halt");
  assert.equal(r.nextState.active, false);
  assert.match(r.reason, /ratchet|criteria/i);
});

test("criteria count increase is allowed and carried into nextState", () => {
  const st = freshState({ criteriaCount: 3 });
  const r = decide({ state: st, spec: { ...spec, criteriaCount: 5 }, checkResults: pass });
  assert.notEqual(r.action, "halt");
  assert.equal(r.nextState.criteriaCount, 5);
});

test("missing state.criteriaCount does not trigger a ratchet halt", () => {
  const st = freshState();
  delete st.criteriaCount;
  const r = decide({ state: st, spec: { ...spec, criteriaCount: 2 }, checkResults: pass });
  assert.notEqual(r.action, "halt");
  assert.equal(r.nextState.criteriaCount, 2);
});
```

(`freshState`, `spec`, and `pass` already exist in this file. The existing `spec` has no `criteriaCount`; the existing tests don't set `state.criteriaCount`, so the guard is skipped for them — see Step 3.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/gate.test.mjs`
Expected: FAIL — no ratchet behavior yet (e.g. the drop case does not `halt`).

- [ ] **Step 3: Implement** — in `lib/gate.mjs`, insert the ratchet guard immediately after the existing config-error (`halt`) block (i.e. right after its closing `}` on the line before `const criticFresh = ...`). Insert:

```js
  // 1b) Ratchet guard: acceptance criteria may only be added, never removed.
  if (state.criteriaCount != null && spec.criteriaCount < state.criteriaCount) {
    return finish(
      "halt",
      `Ratchet violation: acceptance criteria dropped from ${state.criteriaCount} to ${spec.criteriaCount}. Criteria may only be added, never removed. Restore them in the spec and re-run /loop:run.`
    );
  }
  next.criteriaCount = spec.criteriaCount;

```

Notes:
- `state.criteriaCount != null` (loose `!=`) skips the guard when the field is absent (old state files / existing tests), so it can't false-positive.
- `next.criteriaCount = spec.criteriaCount` runs on every non-halt path (before `done`), so the current count is always carried forward. `spec.criteriaCount` may be `undefined` in tests that don't set it — that's fine, it just stores `undefined`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/gate.test.mjs`
Expected: PASS (all gate tests, including the 3 new ones, and all prior ones unchanged).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — spec + state + gate + gate-cli all green.

- [ ] **Step 6: Commit**

```bash
git add lib/gate.mjs test/gate.test.mjs
git commit -m "feat(gate): ratchet guard — acceptance criteria may only grow"
```

---

## Task 4: Rewrite the critic as an evidence-first product reviewer (`agents/loop-critic.md`)

**Files:**
- Modify (full replace): `agents/loop-critic.md`

- [ ] **Step 1: Replace the entire file with:**

```markdown
---
name: loop-critic
description: Adversarial product reviewer for the loop plugin. Actually runs the product (installs, builds, launches, exercises the core flow) and judges whether it genuinely works, is complete, is high quality, and has good UX. Returns strict JSON including newly discovered acceptance criteria.
tools: Read, Grep, Glob, Bash
---

You are a strict senior product reviewer. You did NOT write this code. Your job is to find
what is still wrong, missing, or unverified — not to be encouraging. Assume the author is
biased toward declaring victory; your default verdict is "issues" and you only upgrade to
"clean" when you have evidence the product genuinely works and meets the bar.

You will be given:
- GOAL: what the product/feature is supposed to do.
- ACCEPTANCE CRITERIA: the quality bar (human-authored + any auto-discovered criteria).
- HOW TO RUN: how to install/build/start the app and exercise the core flow (if known).
- CHANGED THIS ROUND: what the author claims to have done.

## Gather evidence — actually run it
Do not judge from reading code alone. Using Bash, to the extent the project allows:
1. Install dependencies from a clean state and confirm the install succeeds.
2. Build / compile and confirm it succeeds with no errors.
3. Start the app/service and confirm it actually runs (process starts, port responds,
   page/endpoint returns success).
4. Exercise the core user flow from the GOAL end to end and observe the result.
Report exactly what you ran and what you observed. If you cannot run it (no run command,
build fails, it crashes), that is itself a blocking issue → verdict "issues".

## Judge four dimensions — all must genuinely pass
- WORKS: end-to-end evidence it runs and the core flow completes. "Code exists" is not
  evidence.
- COMPLETE: every feature implied by the GOAL and CRITERIA is actually implemented.
  Actively grep for and reject TODO / FIXME / stub / mock / "not implemented" /
  placeholder UI / hardcoded fake data standing in for real functionality.
- QUALITY: the code is clean, correct, and maintainable.
- UX: the experience is coherent — clear states, no blank screens, sensible flows,
  reasonable error handling.

## Output — ONLY a single JSON object as your final message, no prose around it
{
  "verdict": "clean" | "issues",
  "findings": ["<specific, actionable violation of an existing criterion>", "..."],
  "newCriteria": ["<a requirement that SHOULD be in the bar but is missing>", "..."]
}

- `verdict: "clean"` ONLY when you actually ran the product, it works end to end, and all
  four dimensions genuinely pass. Use it sparingly. If you could not verify by running, or
  any dimension falls short, return "issues".
- `findings`: ways the CURRENT work violates the EXISTING criteria. Each must be specific
  and actionable (file/behavior, not vibes).
- `newCriteria`: genuinely missing requirements you discovered that the bar should include
  (missing features, important edge cases). Only real gaps — do not invent an endless
  stream. If you add any newCriteria, the work is not done yet, so `verdict` MUST be
  "issues".
- If `verdict` is "issues", then `findings` and/or `newCriteria` must be non-empty.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `node -e "const t=require('fs').readFileSync('agents/loop-critic.md','utf8'); if(!/^---[\s\S]*?---/.test(t)) throw new Error('bad frontmatter'); if(!/newCriteria/.test(t)) throw new Error('missing newCriteria'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add agents/loop-critic.md
git commit -m "feat(critic): evidence-first, four-dimension reviewer with newCriteria"
```

---

## Task 5: Update the `/loop:run` contract for evolution + evidence (`skills/run/SKILL.md`)

**Files:**
- Modify (full replace): `skills/run/SKILL.md`

- [ ] **Step 1: Replace the entire file with:**

```markdown
---
name: run
description: Start an autonomous build-critique loop from a loop spec. Claude builds, then an independent critic actually runs and reviews the product, and Claude iterates until the spec's exit conditions are met or a guardrail trips — without per-round human prompting.
argument-hint: "[name]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent
---

## Run an autonomous loop

Argument (loop name, optional): `$ARGUMENTS`

You are about to run an autonomous loop. The plugin's Stop hook is the engine: every
time you end a turn it runs the spec's automated checks, reads the critic verdict you
recorded, and either (a) sends you back a `block` message telling you exactly what to
fix, or (b) lets the turn end because the loop is satisfied or a guardrail tripped.
**Do not ask the human for feedback between rounds** — the critic plays the reviewer
role that the human used to play.

"Done" is demanding: the independent critic will actually install, build, run, and
exercise the product, and only passes when it genuinely works, is complete (no stubs /
mocks / TODOs), is high quality, and has good UX. So your job each round is to produce a
result that truly runs and is complete — not just code that looks finished.

### Setup (do this once, at the start)
1. Resolve the spec:
   - If `$ARGUMENTS` is given, use `loops/$ARGUMENTS.loop.md`.
   - Else if exactly one `loops/*.loop.md` exists, use it.
   - Else list the specs and ask which one. If none exist, tell the user to run
     `/loop:new` first and stop.
2. Read the spec. Restate to the user: the Goal, the automated `checks`, the quality
   bar (including any `## Discovered criteria (auto …)` section), and the guardrails
   (`max_iterations`, `stall_after`, `on_cap`). Note that `max_spend_usd` is advisory in
   v1 (not enforced) — `max_iterations` is the real bound on cost.
3. Initialize `.loop/state.json` in the project root (create `.loop/` if needed):
   ```json
   { "name": "<name>", "specPath": "loops/<name>.loop.md", "active": true,
     "iteration": 0, "evaluations": 0, "criteriaCount": 0, "lastCritic": null,
     "lastChecks": null, "stallCount": 0, "lastFailSig": null, "history": [] }
   ```
   `evaluations` and `criteriaCount` are owned by the Stop hook — initialize them and
   then never write them yourself.

### The loop (each round — do ALL of this before ending your turn)
You MUST continue into round 1 in the same turn as setup — do not end your turn after
writing `state.json`. (If the hook ever blocks you saying "no iterations have run yet,"
your setup turn ended early: just proceed with round 1 below.)

1. Read `.loop/state.json`. Set `iteration = iteration + 1` and write it back.
2. Do the work: build or improve the feature toward the Goal so that it actually runs
   end to end. On round 1, start implementing. On later rounds, address the feedback
   from the hook's last `block` message (failing checks and/or critic findings) and any
   newly added criteria.
3. Dispatch the **`loop-critic`** subagent (use the Agent tool with
   `subagent_type: "loop-critic"`). Give it:
   - GOAL (from the spec)
   - ACCEPTANCE CRITERIA (the full `# Quality bar`, human + auto)
   - HOW TO RUN (how to install/build/start the app and exercise the core flow — pull
     this from the spec's Goal/criteria, the `checks`, and the project's package.json /
     Makefile / README)
   - CHANGED THIS ROUND (a short summary of what you just did)
   It returns strict JSON: `{ "verdict": "clean" | "issues", "findings": [...],
   "newCriteria": [...] }`.
4. If `newCriteria` is non-empty, evolve the spec — **append-only**: add each item as a
   new `- [ ] <criterion>` line under a `## Discovered criteria (auto — added by
   loop-critic; only added, never removed)` subsection inside the spec's `# Quality bar`.
   Create that subsection if it doesn't exist yet. NEVER modify or remove human-authored
   lines or previously-added auto lines — only append. (The gate halts the loop if the
   criteria count ever drops.)
5. Record the verdict into `.loop/state.json`:
   `"lastCritic": { "iteration": <current iteration>, "verdict": <verdict>, "findings": <findings> }`
   `lastCritic.iteration` MUST equal the current `iteration`, or the hook will send you
   straight back to run the critic for this round.
6. End your turn. The hook now evaluates. If it returns a `block` response, start the
   next round at step 1, addressing exactly what it listed. If your turn ends without a
   `block` response, the loop is finished — either cleanly (checks pass, critic clean;
   you'll see no message) or because a guardrail tripped (you'll receive a
   `systemMessage` saying which). Either way, do not start another round.

### Ending
The loop ends when:
- **Delivered** — checks pass AND the critic verdict is `clean` (it ran the product, and
  all four dimensions — works / complete / quality / UX — genuinely pass). The hook
  allows the turn to end with no further message; your last round's summary is the record.
- **Guardrail tripped** — `max_iterations` reached, `stall_after` rounds with no
  progress, a misconfigured check, or a ratchet violation (criteria removed). The hook
  returns a `systemMessage` explaining why. When you see it, summarize for the user:
  iterations used, final check status, the critic's last verdict, and what remained
  unresolved.

Do not re-run the loop after it ends unless the user asks. The hook has set
`active: false`; to run again, start over with `/loop:run`.
```

- [ ] **Step 2: Verify frontmatter + key content present**

Run: `node -e "const t=require('fs').readFileSync('skills/run/SKILL.md','utf8'); if(!/^---[\s\S]*?---/.test(t)) throw new Error('bad frontmatter'); ['newCriteria','Discovered criteria','append-only'].forEach(k=>{if(!t.includes(k)) throw new Error('missing '+k)}); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add skills/run/SKILL.md
git commit -m "feat(run): evidence-based done + append-only criteria evolution"
```

---

## Task 6: Higher default bar in `/loop:new` and the template

**Files:**
- Modify (full replace): `templates/loop.template.md`
- Modify (full replace): `skills/new/SKILL.md`

- [ ] **Step 1: Replace `templates/loop.template.md` with:**

```markdown
---
max_iterations: 15
max_spend_usd: 5
stall_after: 3
critic: subagent
on_cap: stop_and_report
checks:
  - run: <clean install, e.g. rm -rf node_modules && npm ci || npm install>
  - run: <build, e.g. npm run build>
  - run: <run/smoke, e.g. the test suite or a script that boots the app and hits it>
---

# Goal
<Describe what to build or polish, in plain language. Include HOW TO RUN it: the command
to start the app/service and the core user flow that must work end to end.>

# Quality bar
<"Done" means the product genuinely works, not just that code exists. The independent
critic will install, build, run, and exercise it. Keep these high-bar items; add your own.>
- [ ] Installs cleanly from scratch and builds with no errors
- [ ] The app/service actually starts and the core flow works end to end
- [ ] All features implied by the Goal are complete — no stubs, mocks, TODOs, or placeholders
- [ ] Code is clean and maintainable
- [ ] Good UX — clear states, no blank screens, sensible errors

## Discovered criteria (auto — added by loop-critic; only added, never removed)
```

- [ ] **Step 2: Replace `skills/new/SKILL.md` with:**

```markdown
---
name: new
description: Scaffold a new loop spec (loops/<name>.loop.md) by interviewing the engineer for the goal, how to run it, exit conditions, and guardrails.
argument-hint: "[name]"
---

## Create a loop spec

The user wants to author a new loop spec. The argument (if any) is the loop name:
`$ARGUMENTS`.

1. Decide the name: use `$ARGUMENTS` if provided, else ask for a short kebab-case
   name (e.g. `login-api`).
2. Interview the engineer, ONE question at a time, to fill in:
   - **Goal**: what feature/product to build or polish.
   - **How to run it**: the command(s) to install, build, and start the app/service, and
     the **core user flow** that must work end to end. The critic needs this to actually
     run and verify the product — capture it in the Goal section.
   - **Automated checks** (`checks`): shell commands that must exit 0 for "done". Push for
     real verification: a clean install, a build, and a run/smoke command (not just a
     unit test). Confirm the real commands for THIS repo — look at package.json /
     Makefile / README if unsure.
   - **Quality bar**: acceptance criteria the critic reviews against. Keep the template's
     high-bar defaults (works end to end, complete/no stubs, quality, UX) and add any
     project-specific ones.
   - **Guardrails**: max_iterations (hard cap), stall_after, optional max_spend_usd
     (advisory in v1), on_cap (`stop_and_report`; `ask_human` is accepted but treated as
     `stop_and_report` in v1).
3. Read `${CLAUDE_PLUGIN_ROOT}/templates/loop.template.md` as the starting shape, fill it
   in with the answers (keep the `## Discovered criteria (auto …)` subsection — leave it
   empty for the critic to grow), and write it to `loops/<name>.loop.md` in the repo
   (create the `loops/` directory if needed).
4. Show the engineer the written file and tell them they can edit it by hand, then run
   `/loop:run <name>` to start the loop.

Do not start the loop yourself — `/loop:new` only authors the spec.
```

- [ ] **Step 3: Verify both files**

Run: `node -e "const fs=require('fs'); const tpl=fs.readFileSync('templates/loop.template.md','utf8'); const nw=fs.readFileSync('skills/new/SKILL.md','utf8'); if(!/^---[\s\S]*?---/.test(tpl)||!/^---[\s\S]*?---/.test(nw)) throw new Error('bad frontmatter'); if(!tpl.includes('Discovered criteria (auto')) throw new Error('template missing auto subsection'); if(!nw.includes('How to run')) throw new Error('new missing run question'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Sanity-check the template still parses and counts its default criteria**

Run: `node -e "import('./lib/spec.mjs').then(m=>{const s=m.parseSpec(require('fs').readFileSync('templates/loop.template.md','utf8')); console.log('criteriaCount', s.criteriaCount); if(s.criteriaCount!==5) throw new Error('expected 5 default criteria, got '+s.criteriaCount)})"`
Expected: `criteriaCount 5`

- [ ] **Step 5: Commit**

```bash
git add templates/loop.template.md skills/new/SKILL.md
git commit -m "feat(new): high default bar + ask how-to-run; auto criteria subsection"
```

---

## Task 7: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`** — replace the `## How it works` section's body and add the new behavior. Specifically, find this paragraph under `## How it works`:

```markdown
3. `/loop:run <name>` starts the loop. Each round Claude builds, then an independent
   `loop-critic` subagent adversarially reviews the work. A `Stop` hook runs the checks
   and reads the critic's verdict, then either feeds back what's left (continue) or ends
   the loop (delivered / capped).
```

and replace it with:

```markdown
3. `/loop:run <name>` starts the loop. Each round Claude builds, then an independent
   `loop-critic` subagent **actually runs the product** — installs, builds, launches, and
   exercises the core flow — and judges it across four dimensions: **works, complete
   (no stubs/mocks/TODOs), code quality, and UX**. It only passes with evidence the thing
   genuinely works. A `Stop` hook runs the checks and reads the verdict, then either feeds
   back what's left (continue) or ends the loop (delivered / capped).

### Self-evolving quality bar

The critic also returns **newly discovered acceptance criteria** — requirements that
should be in the bar but were missing (e.g. a feature you didn't spell out). Each round
these are appended (never removed) to a `## Discovered criteria (auto …)` section inside
your `loops/<name>.loop.md`, so the bar tightens as the loop learns and persists across
runs. The gate enforces this ratchet: if the criteria count ever drops, the loop halts.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 3: Smoke-test the gate ratchet end to end** (optional manual check)

Run:
```bash
node -e "import('./lib/gate.mjs').then(({decide})=>{const spec={caps:{maxIterations:5,stallAfter:3},checks:[],onCap:'stop_and_report',criteriaCount:2};const state={name:'x',specPath:'loops/x.loop.md',active:true,iteration:1,evaluations:1,criteriaCount:4,lastCritic:{iteration:1,verdict:'clean',findings:[]},lastChecks:null,stallCount:0,lastFailSig:null,history:[]};const r=decide({state,spec,checkResults:[]});console.log(r.action, '/', r.reason.slice(0,40))})"
```
Expected: prints `halt / Ratchet violation: ...` (criteria dropped 4 → 2).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document evidence-based done + self-evolving criteria"
```

---

## Manual end-to-end test (after implementation)

1. In a throwaway repo with a deliberately incomplete app (e.g. a backend route that
   returns a hardcoded mock instead of real data), `/loop:new demo` — set `checks` to a
   clean install + build + a run/smoke command, describe how to run it and the core flow.
2. `/loop:run demo`.
3. Confirm: the critic actually installs/builds/runs the app, flags the mock as
   incomplete (verdict issues), possibly adds a discovered criterion, and the loop keeps
   going — it does NOT declare done while the mock/stub is present.
4. Confirm the auto subsection in `loops/demo.loop.md` grows with discovered criteria, and
   that manually deleting criteria then re-running `/loop:run` halts with a ratchet message.

---

## Self-review notes

- **Spec coverage:** evidence-first 4-dimension critic (Task 4); newCriteria schema (Task 4)
  + append-only evolution (Task 5); ratchet guard with criteriaCount (Tasks 1–3); higher
  defaults + how-to-run interview (Task 6); docs (Task 7). ✅
- **Type/field consistency:** `criteriaCount` is produced by `parseSpec` (Task 1), seeded in
  `initState` (Task 2), read/written by `decide` as `state.criteriaCount` / `spec.criteriaCount`
  / `next.criteriaCount` (Task 3), and initialized in the `/loop:run` state JSON (Task 5).
  Critic returns `{verdict, findings, newCriteria}` (Task 4) consumed by `/loop:run` (Task 5).
- **Decisions honored:** ratchet-only (count guard), quality-bar-only evolution, critic-proposed,
  evidence-based done. `newCriteria` ⇒ verdict "issues" stated in the critic prompt (Task 4).
- **Known limitation (documented in the design):** the ratchet guard is count-based; a
  same-count reword that weakens a criterion is not detected in v1.
```
