# `loop` — Autonomous build–critique loop plugin for Claude Code

**Status:** Design approved (brainstorming)
**Date:** 2026-06-09
**Author:** chuhaobing (haobing0304@gmail.com)

## Problem

Today's agentic coding is a human-in-the-loop cycle: the agent does one round of
work, stops, asks the human for an opinion, the human reviews and gives feedback,
the agent revises — repeat. The human is the bottleneck and the critic on every
single iteration ("prompt engineering / vibe coding").

We want the opposite: an engineer writes down **what they want** and **when it's
done**, runs one command, and Claude **iteratively builds and polishes the feature
on its own** — generating its own critical feedback each round (the role the human
used to play) — until the feature actually meets the bar. No per-round human
prompting.

This is the "write loops, not prompts" idea: the engineer authors a loop, not a
stream of prompts.

## Goal

A Claude Code plugin named `loop` that runs an **autonomous build–critique loop
inside the engineer's current Claude Code session**:

1. The engineer authors a **loop spec** — the requirement (goal), the exit/done
   conditions, and guardrails.
2. The engineer runs `/loop:run`.
3. Claude iterates: **build → independent critique → improve → re-critique** until
   the exit conditions are met (critic finds no material issues **and** automated
   checks pass) or a guardrail trips.

The loop is **not** re-running one fixed command. Each iteration is genuine
refinement driven by self-generated critique, not by repetition and not by human
feedback.

## Non-goals (v1)

- Unattended/headless background runs (Agent SDK while-loop with hard
  `max_budget_usd`). Architecture leaves room for this later, but v1 runs in the
  interactive session.
- Cloud routines / `/schedule` (wrong semantics — recurring, min 1h, not
  "until-done").
- Multi-feature orchestration. v1 = one loop, one feature/deliverable at a time.

## Approach

**A — In-session Stop-hook loop** (chosen over a headless SDK script or a cloud
routine). Lowest friction, plugin-native, full tool access, the engineer can watch
and interject, zero extra infrastructure. The interactive session is occupied
while the loop runs; long runs rely on context compaction. `max_iterations` is a
hard floor that guarantees termination; `Esc` always aborts.

## The build–critique loop

The decision to continue is driven by **self-generated critique**, not by human
opinion and not by mechanical repetition. Each iteration:

1. **Build** — Claude does/improves the work toward the goal.
2. **Critique** — Claude spawns an **independent critic subagent** (fresh context,
   adversarial prompt: "as a strict senior reviewer, find what's still wrong and
   what would get this rejected"). Independent context is the point — it avoids the
   "I made it, so it's fine" bias and stops the loop from declaring done too early.
3. The critic's findings + the automated checks form the **gate**.
4. **Gate decision** (enforced by the Stop hook):
   - Critic finds material issues **or** automated checks fail → **continue**:
     feed the critique items + failing checks back; Claude addresses them next
     round.
   - Critic finds no material issues **and** all automated checks pass → **done**.

Why a subagent (not self-assessment in the same context): chosen for reliability —
same-context self-grading is lenient and stops early. Cost is higher but quality is
the point.

## Components

### 1. loop spec — what the engineer writes (the core artifact)

Location: `loops/<name>.loop.md` in the engineer's repo. Markdown + YAML
frontmatter (hand-writable, readable). Named `*.loop.md` under `loops/` to avoid
colliding with the built-in `.claude/loop.md` customization file.

```markdown
---
# Guardrails
max_iterations: 15          # hard cap — guarantees the loop terminates
max_spend_usd: 5            # best-effort spend ceiling (estimated from usage)
stall_after: 3              # same failing gate N rounds in a row -> stop & report

# Exit conditions — automated checks (machine-checked; exit code 0 = pass)
checks:
  - run: npm test
  - run: npm run build
  - run: npx tsc --noEmit

# Critic
critic: subagent            # v1 default: independent critic subagent

# Behavior when a cap/stall trips
on_cap: stop_and_report     # or: ask_human
---

# Goal
<free-text requirement: what feature to build / polish>

# Quality bar / acceptance criteria
<prose + checklist the critic reviews against; subjective items live here>
- [ ] <e.g. clear error states, no blank screens>
- [ ] <e.g. responsive at mobile widths>
```

- **Automated checks** (`checks`) → run deterministically by the gate (shell exit
  codes).
- **Quality bar / acceptance criteria** (prose + checklist) → what the critic
  subagent reviews against. Subjective requirements that no command can verify live
  here.

### 2. Slash commands (plugin skills)

- **`/loop:new [name]`** — interview-style scaffolder: asks for the goal, exit
  conditions, and caps, then writes a `loops/<name>.loop.md` template the engineer
  edits. Solves "I don't know how to write a spec."
- **`/loop:run [name]`** — starts the loop: loads + validates the spec, initializes
  state, injects the goal + spec, and instructs Claude to run the build → critique
  cycle, recording the critic's findings into state before ending each turn.
  Defaults to the single spec in `loops/` if `name` omitted.

### 3. Engine — Stop hook

Registered in `hooks/hooks.json` on the `Stop` event. Calls `bin/loop-gate`. Per
turn-end:

1. Load state; increment iteration.
2. Run the spec's automated `checks` (shell, exit codes). Read the critic findings
   Claude recorded for this round.
3. Decide:
   - **All checks pass AND critic found no material issues** → allow stop; print
     "✅ delivered in N iterations".
   - **Failing checks or open critic findings, under caps** → block stop; reason =
     failing checks + critic items + remaining budget → Claude continues
     automatically, no human prompt.
   - **Cap/stall tripped** (`max_iterations` / `max_spend_usd` / `stall_after`) →
     behave per `on_cap` (allow stop + report, or ask the human).

`bin/loop-gate` is a **Node** script (Claude Code ships a Node runtime; native
JSON; unit-testable). It owns the riskiest logic — parse spec, run checks, decide —
and is covered by tests (TDD).

> Note on the split: a Stop hook is a shell process and cannot itself invoke
> Claude. So **Claude does the building and spawns the critic subagent during its
> turn** and writes the critic's findings to state; the **hook reads those findings
> + runs the deterministic checks** and makes the keep-going/stop decision. This
> separation is what makes the in-session loop work.

### 4. State file

`.loop/<name>.state.json`: iteration count, estimated spend/turns, last round's
check results, latest critic findings, stall counter, history. Read/written by both
the hook and Claude.

### 5. Packaging

Standard plugin layout:

```
loop/
├── .claude-plugin/plugin.json     # manifest: name "loop", version, description
├── skills/
│   ├── new/SKILL.md               # /loop:new
│   └── run/SKILL.md               # /loop:run
├── hooks/hooks.json               # registers Stop -> bin/loop-gate
├── bin/loop-gate                  # Node gate script (executable)
├── test/                          # unit tests for loop-gate
└── README.md
```

## Data flow (one iteration)

1. Engineer: `/loop:run` (spec already authored, or `/loop:new` first).
2. `/loop:run` injects goal + spec + instruction: build toward the goal; spawn an
   independent critic subagent to review against the quality bar; write the critic's
   findings to `.loop/<name>.state.json`; then end the turn.
3. Claude builds, spawns critic, records findings, ends turn.
4. Stop hook fires → `bin/loop-gate`: runs automated checks, reads critic findings,
   increments iteration.
   - pass + clean critique → allow stop, success summary.
   - failing/open + under caps → block, feed back failures + critic items → Claude
     continues.
   - cap/stall → per `on_cap`.
5. Repeat until done or capped.

## Error handling / guardrails (termination is guaranteed)

- `max_iterations` is a hard floor — the loop always stops; `Esc` always aborts.
- Distinguish a check **erroring** (e.g. command-not-found → config error → stop &
  report) from a check **legitimately failing** (→ continue). Don't burn budget on
  a misconfigured command.
- **Stall detection:** the same failing gate `stall_after` rounds in a row → stop &
  report (no death-loop burning budget).
- Spec missing/invalid → `/loop:run` refuses and points to `/loop:new`.
- Corrupt/unreadable state → fail safe (allow stop; never trap the engineer in the
  loop).

## Testing

- `bin/loop-gate` is the riskiest unit → TDD as a standalone script. Scenarios:
  all checks pass + clean critique (done); a failing check (continue);
  open critic findings (continue); `max_iterations` reached (stop); `stall_after`
  reached (stop); corrupt state (fail safe); command-not-found (config error).
- Manual end-to-end: a small sample repo with a deliberately incomplete feature; run
  `/loop:run` and confirm it builds, critiques, iterates, and stops on success.

## Decisions made for the engineer

- Gate script language: **Node** (guaranteed runtime, native JSON, testable).
- Spec format: **markdown + frontmatter** (hand-writable, readable) over pure YAML.
- Critic: **independent subagent** (reliability over cost).
- Loop engine: **in-session Stop hook** (over headless SDK / cloud routine) for v1.
