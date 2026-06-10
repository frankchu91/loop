# Evidence-based, self-evolving "done" for the loop plugin

**Status:** Design approved (brainstorming)
**Date:** 2026-06-09
**Author:** chuhaobing
**Builds on:** docs/superpowers/specs/2026-06-09-loop-plugin-design.md

## Problem

The loop exits too easily. Today "done" means *code looks written* + *the critic
glanced at it statically*. Building an app (frontend + backend) "completes" after ~2
rounds — but the user still has to install dependencies, run it, and test it by hand.
The loop never verified the thing actually works, and it accepted half-built features.

The user wants a higher bar for "done":

1. **It actually works** — deps install from clean, it builds, it runs, the core flow works.
2. **Code quality is high.**
3. **The user experience is good.**
4. **All features are complete** — no stubs, mocks, TODOs, or placeholders.

The original ask ("the spec should self-evolve each round") is one mechanism for (4):
when the user didn't specify everything up front, the critic discovers missing
requirements and adds them, so the loop can't exit while features are missing.

## Goal

Make "done" evidence-based and the bar self-tightening:

- The independent `loop-critic` becomes a rigorous **product reviewer that runs the
  product** and may only pass with evidence it works across four dimensions (works /
  complete / quality / UX).
- The spec's quality bar **self-evolves (ratchet-only)**: the critic appends newly
  discovered acceptance criteria to the spec each round; criteria can only be added,
  never silently removed.
- `/loop:new` and the template default to a high bar and real verification checks.

## Non-goals

- Changing the core gate decision flow (done/cap/stall/halt/block) — unchanged.
- Visual/screenshot UX verification tooling — the critic judges UX from the running app
  and code; no new screenshot pipeline in this iteration.
- Evolving anything except the quality bar. The Goal, checks, and guardrails remain
  engineer-authored (decided in brainstorming: quality-bar only, ratchet-only,
  critic-proposed).
- True cross-run resume of iteration/history counters (separate, deferred).

## Decisions locked in brainstorming

- **Evolution direction:** ratchet-only — criteria can only be added/strengthened,
  never relaxed.
- **Evolution scope:** the quality bar only.
- **Who proposes:** the independent `loop-critic` subagent.
- **Done bar:** the four dimensions above; the critic must run the product for evidence.

## Design

### 1. `loop-critic` becomes an evidence-first, multi-dimension product reviewer

`agents/loop-critic.md` is rewritten so the critic:

- **Gathers evidence by running the product**, not just reading it: install deps from a
  clean state, build, start the app/service, and exercise the core flow described in the
  spec. It reports exactly what it ran and the observed result.
- **Judges four dimensions**, each must genuinely pass:
  - **Works** — end-to-end evidence it runs (process starts, endpoint/page responds,
    core flow completes). "Code exists" is not evidence.
  - **Complete** — actively hunts for `TODO`, `FIXME`, `stub`, `mock`, `not implemented`,
    placeholder UI, and any feature implied by the Goal/criteria but absent. Any
    half-built feature → not complete.
  - **Quality** — code is clean and maintainable.
  - **UX** — the experience is coherent (clear states, no blank screens, sensible flows).
- **Returns strict JSON** `{ verdict, findings, newCriteria }`:
  - `verdict: "clean"` ONLY when all four dimensions pass AND it has evidence the product
    runs. Default to `"issues"`. If it could not run the product, that itself is `issues`.
  - `findings`: ways the current work violates the **existing** bar (drives code fixes).
  - `newCriteria`: requirements that **should** be in the bar but are missing — discovered
    missing features/edge cases (drives spec evolution). Genuinely-new gaps only, not an
    endless stream. When `newCriteria` is non-empty, `verdict` is `"issues"` (the spec was
    incomplete, so the work isn't done).
- Tools: `Read, Grep, Glob, Bash` (Bash is required to actually run the product).

### 2. Spec self-evolution (ratchet-only, quality bar only)

Each round, after the critic returns, `/loop:run` appends any `newCriteria` to a clearly
marked, auto-managed subsection inside the spec's `# Quality bar`:

```markdown
# Quality bar
- [ ] <human-authored criteria>

## Discovered criteria (auto — added by loop-critic; only added, never removed)
- [ ] <round N> <discovered requirement>
```

- Append-only. Claude must never modify or remove human-authored lines or existing
  auto lines — it only appends new ones.
- Written into `loops/<name>.loop.md`, so the evolved bar **persists across runs** and the
  engineer can read, curate, or promote/delete entries by hand.
- The spec parser already captures everything under `# Quality bar` (an H2 subsection
  doesn't terminate the H1 section), so the accumulated criteria are fed to the critic in
  subsequent rounds automatically.

### 3. Stronger defaults in `/loop:new` and the template

- `templates/loop.template.md` ships a default `# Quality bar` that encodes the four
  dimensions ("installs clean, builds, runs, core flow works, all features complete, no
  stubs/mocks, good UX") and the empty `## Discovered criteria (auto …)` subsection.
- Default `checks` push real verification: a clean install, a build, and a run/smoke
  command.
- `/loop:new` interview additionally asks **how to start the app and what the core flow
  is**, so the critic knows how to run and exercise it. It records these in the spec
  (Goal/criteria body) so the critic has them.

### 4. Engine-side ratchet guard (small, in the gate)

To enforce "only added, never removed" without trusting the model:

- `lib/spec.mjs` exposes `criteriaCount` on the parsed spec: the number of checkbox items
  (`- [ ]` / `- [x]`) in the criteria section.
- `lib/state.mjs` `initState` adds `criteriaCount: 0`.
- `lib/gate.mjs`: at the start of `decide`, if `state.criteriaCount != null` and the
  spec's current `criteriaCount < state.criteriaCount`, return `action: "halt"` with a
  ratchet-violation reason (criteria were removed). Otherwise store the current count in
  `next.criteriaCount`. This runs after the existing config-error (`halt`) check and
  before `done`, so a weakened bar can never produce a `done`.

This is a lightweight monotonicity guard (count-based). It catches the obvious violation
(removing criteria). It does not detect a same-count reword that weakens a criterion —
acceptable for v1; the append-only contract + marked section + independent critic cover
the rest. Noted as a limitation.

## Data flow (one round, updated)

1. Claude builds/improves toward the Goal, producing a runnable result.
2. Claude dispatches `loop-critic`, passing the Goal, the full quality bar (human + auto),
   and how to run/exercise the app.
3. The critic installs/builds/runs/exercises the product, judges the four dimensions, and
   returns `{ verdict, findings, newCriteria }`.
4. Claude appends `newCriteria` (if any) to the auto subsection of `loops/<name>.loop.md`,
   then records `lastCritic = { iteration, verdict, findings }` in state.
5. Stop hook → gate: ratchet guard, run checks, decide. `done` requires checks pass AND
   `verdict === "clean"` — which now means the critic ran it and all four dimensions held.

## Error handling

- Critic cannot run the product (no run command, build fails) → it returns `issues` with a
  finding saying so; the loop continues to fix it. It never passes on inability to verify.
- Ratchet violation (criteria count dropped) → gate halts with a clear message; the
  engineer fixes the spec. Fail-safe (allow stop), never traps the user.
- All existing fail-safes (missing/corrupt state, unreadable spec, hard cap, stall)
  unchanged.

## Testing

- `lib/spec.mjs`: `criteriaCount` counts checkbox items across human + auto subsections;
  zero when none.
- `lib/gate.mjs`: ratchet violation (count drop) → `halt`; count increase or equal →
  proceeds normally; `done` still works when count is stable; `criteriaCount` carried in
  `nextState`.
- `lib/state.mjs`: `initState` includes `criteriaCount: 0` (round-trip unaffected).
- Critic/run/template/`/loop:new` are prompt/content changes — verified by frontmatter
  parse + manual review (the four-dimension language, evidence requirement, append-only
  instruction, and `newCriteria` schema are present and consistent across files).

## Files touched

- `agents/loop-critic.md` — evidence-first, four-dimension, `newCriteria` schema.
- `skills/run/SKILL.md` — pass run/flow info to critic; append `newCriteria` (append-only);
  updated "what done means".
- `skills/new/SKILL.md` — ask how to run + core flow; default high bar.
- `templates/loop.template.md` — four-dimension default bar, real checks, auto subsection.
- `lib/spec.mjs` — `criteriaCount`.
- `lib/state.mjs` — `criteriaCount: 0` in `initState`.
- `lib/gate.mjs` — ratchet guard.
- `README.md` — document evidence-based done + self-evolving criteria.

## Decisions made for the engineer

- Ratchet guard is count-based (monotonic), not a full hash of the human section —
  simplest guard that enforces "only added"; reword-weakening not detected in v1.
- The critic judges UX from the running app + code; no screenshot tooling this iteration.
- `newCriteria` ⇒ `verdict: "issues"` so a freshly-grown bar can't be declared done the
  same round.
