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
