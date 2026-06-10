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

The loop runs **in your current Claude Code session**: the Stop hook intercepts the end
of each turn, so Claude keeps iterating without you re-prompting.

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

- **Automated checks** (`checks`) are run by the gate each round; exit code 0 = pass.
- **Quality bar** is what the independent critic subagent reviews against — the place
  for subjective requirements no command can verify.

## Guardrails (termination is guaranteed)

- **`max_iterations`** is a hard floor. The gate counts its own evaluations (one per
  turn), so the loop always terminates after that many turns — even if the model
  misbehaves. `Esc` aborts anytime.
- **Stall detection** stops the loop if the same failures repeat `stall_after` rounds.
- A check command that **errors** (e.g. command-not-found) halts with a config error
  instead of burning iterations.
- The gate is **fail-safe**: any unexpected error (missing/corrupt state, unreadable
  spec) allows the turn to end rather than trapping you in the loop.
- **`max_spend_usd` is advisory in v1** — a Stop hook has no reliable in-session spend
  figure. Use `max_iterations` to bound cost.

## State

`.loop/state.json` (gitignored) tracks the active loop: iteration, gate evaluations,
last checks, last critic verdict, stall counter, history. When the loop ends the gate
sets `active: false`; delete the file to reset.

## Install

This is a Claude Code plugin. Point your plugin config at this directory (or add it to a
marketplace) so `/loop:new` and `/loop:run` appear. The Stop hook invokes
`node "${CLAUDE_PLUGIN_ROOT}/bin/loop-gate.mjs"` — Node (v18+) must be on PATH.

## Develop

```bash
npm test   # runs lib + cli tests with node --test
```
