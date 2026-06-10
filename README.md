# loop

**Write loops, not prompts.**

`loop` is a Claude Code plugin that turns one-shot prompting into an autonomous
build–critique loop. You write down *what you want* and *when it's done*; Claude then
builds it, reviews its own work with an independent critic, and keeps iterating —
**without you re-prompting after every round** — until the work actually meets the bar
or a guardrail stops it.

It replaces the usual cycle of *"agent does a round → you eyeball it → you give feedback
→ agent revises → repeat"*. The human-in-the-loop reviewer is the bottleneck; `loop`
moves that reviewer role into an independent critic so the iteration runs on its own.

---

## Inspiration

> "I don't prompt Claude anymore. I have loops that are running. They're the ones that
> are prompting Claude."
>
> — **Boris Cherny**, a creator of Claude Code at Anthropic
> (as quoted in Matt Van Horn's [*WTF Is a Loop?*](https://x.com/mvanhorn/article/2063865685558903149))

That shift — engineers **writing loops that drive coding agents** instead of prompting
them turn by turn — is what `loop` is built around. The same article frames it as Boris
Cherny vs. **Peter Steinberger**; `loop` is an open-source take on the idea for Claude Code.

> Independent project — not affiliated with, nor endorsed by, those individuals or
> Anthropic.

---

## Why

The expensive part of agentic coding isn't writing code anymore — it's the back-and-forth.
Every round you have to stop, read, judge, and re-prompt. `loop` removes that tax:

- **You specify the destination, not each step.** A short spec file captures the goal,
  the objective pass/fail checks, and the quality bar.
- **Done means it actually works.** Each round an independent `loop-critic` subagent
  (fresh context, told to find what's wrong) **runs the product** — installs, builds,
  launches, exercises the core flow — and judges it across four dimensions: works,
  complete (no stubs/mocks/TODOs), code quality, and UX. "Code exists" is not "done".
- **The bar self-tightens.** The critic also surfaces missing requirements, which are
  appended (never removed) to your spec, so the loop can't exit while features are missing.
- **It stops itself, safely.** The loop ends when checks pass *and* the critic is clean —
  or when a hard guardrail trips. Termination is guaranteed.

---

## How it works

```
/loop:run
   │
   ▼
┌─────────────────────────────────────────────┐
│  ROUND (one Claude turn)                      │
│   1. build / improve toward the Goal          │
│   2. loop-critic RUNS the product + reviews   │
│      (install, build, launch, exercise flow)  │
│   3. append any newly discovered criteria     │
│   4. record critic verdict into state         │
└─────────────────────────────────────────────┘
   │  turn ends
   ▼
Stop hook → loop-gate
   • runs the spec's automated checks
   • reads the critic verdict
   • decides:
       checks pass AND critic clean  → DONE (loop ends)
       guardrail tripped             → STOP + report
       otherwise                     → BLOCK: feed back what's
                                       left → Claude continues
```

The loop runs **inside your current Claude Code session**. A `Stop` hook intercepts the
end of each turn, so Claude keeps going on its own instead of handing control back to you.

### Evidence-based "done"

The critic does not judge from reading code. It actually installs dependencies from
clean, builds, starts the app/service, and exercises the core flow — and only returns
`clean` with evidence the product genuinely works across all four dimensions. If it
can't run the thing, that's a failure, not a pass.

### Self-evolving quality bar

The critic also returns **newly discovered acceptance criteria** — requirements that
should be in the bar but were missing (e.g. a feature you didn't spell out). Each round
these are appended (never removed) to a `## Discovered criteria (auto …)` section inside
your `loops/<name>.loop.md`, so the bar tightens as the loop learns and persists across
runs. The gate enforces this ratchet: if the criteria count ever drops, the loop halts.

---

## Install

`loop` is a local Claude Code plugin. Clone it, then add it as a local marketplace.

```bash
git clone https://github.com/frankchu91/loop.git
```

Then, in Claude Code (replace `/path/to/loop` with wherever you cloned it):

```text
/plugin marketplace add /path/to/loop
/plugin install loop@loop
```

- `loop@loop` is `<plugin>@<marketplace>` — both are named `loop` (the marketplace name
  comes from `.claude-plugin/marketplace.json`).
- Pick **user scope** to use it everywhere, or **local scope** for one repo only.

Verify it loaded:

- `/plugin` → the **Installed** tab shows `loop`, the **Errors** tab is empty
- `/hooks` → a `Stop` hook is listed
- type `/loop:` → it completes to `/loop:new` and `/loop:run`

**Requirement:** Node (v18+) on your `PATH` — the Stop hook runs
`node "${CLAUDE_PLUGIN_ROOT}/bin/loop-gate.mjs"`.

After editing plugin files during development, reload without restarting:

```text
/reload-plugins
```

If a change doesn't take or you see a load error, do a clean reinstall:

```text
/plugin uninstall loop@loop
/plugin marketplace remove loop
/plugin marketplace add /path/to/loop
/plugin install loop@loop
```

> **Note on the manifest:** `.claude-plugin/plugin.json` intentionally declares **no**
> component paths. Claude Code auto-discovers `skills/`, `agents/`, and `hooks/hooks.json`
> by convention. Do **not** add `skills` / `agents` / `hooks` keys back to the manifest —
> doing so either fails validation (`agents` only accepts file paths, not a directory) or
> double-loads `hooks/hooks.json` ("Duplicate hooks file detected").

---

## Usage

> ⚠️ Try it on a throwaway/test repo first. A loop autonomously edits files until the
> bar is met — watch how it behaves before pointing it at important work.

### 1. Author a loop spec

```text
/loop:new login-api
```

This interviews you (goal, checks, quality bar, guardrails) and writes
`loops/login-api.loop.md`. The name is just a label for *this* loop — use a short
`kebab-case` name that says what it does. You can keep several specs in `loops/`, one
per task.

You can also write/edit the spec by hand.

### 2. Run it

```text
/loop:run login-api
```

Then **leave it alone — don't give feedback between rounds.** The critic plays the
reviewer role. (If `loops/` contains exactly one spec, you can omit the name:
`/loop:run`.)

### 3. Read the outcome

- **Loop ends with no further prompt** → delivered (checks pass, critic clean). The last
  round's summary is the result.
- **It reports a guardrail** (`max_iterations` / stall / misconfigured check) → it stopped
  and tells you what remained unresolved.
- **Stop it anytime** → press `Esc`.
- **Inspect progress** → `.loop/state.json` (iteration, last critic verdict, last check
  results, stall counter).

---

## The spec file

`loops/<name>.loop.md` — YAML frontmatter (machine-readable config) + a markdown body
(the goal and the human-readable quality bar).

```markdown
---
max_iterations: 15        # hard cap — guarantees the loop terminates
max_spend_usd: 5          # advisory only in v1 (not enforced)
stall_after: 3            # same failures N rounds in a row → stop
critic: subagent          # v1: independent critic subagent
on_cap: stop_and_report   # ask_human is accepted but treated as stop_and_report in v1
checks:
  - run: npm test
  - run: npm run build
  - run: npx tsc --noEmit
---

# Goal
Wire the login page to the real backend API, replacing the current mock.

# Quality bar
- [ ] Login failure shows a clear error message, never a blank screen
- [ ] The form does not overflow at mobile widths
```

| Field | Meaning |
|-------|---------|
| `checks` | Shell commands run by the gate each round. **Exit code 0 = pass.** These must be commands that actually run in this repo. |
| `# Goal` | What to build or polish, in plain language. |
| `# Quality bar` | Subjective acceptance criteria the **critic** reviews against — for things no command can verify. |
| `max_iterations` | Hard cap on rounds. The loop always stops at this many turns. |
| `stall_after` | Stop if the same set of failures repeats this many rounds. |
| `on_cap` | What to do when a cap trips: `stop_and_report` (default). |

**Two things define "done":** the objective `checks` (machine-verified) **and** the
critic's verdict against the quality bar (judgment). Both must be satisfied.

---

## Guardrails (termination is guaranteed)

- **`max_iterations` is a hard floor.** The gate counts its own evaluations (one per
  turn), so the loop terminates after that many turns even if the model misbehaves.
- **Stall detection** stops the loop when the same failures repeat `stall_after` rounds —
  no burning budget in a death loop.
- **Misconfigured checks halt early.** A check command that errors (e.g. command-not-found)
  stops with a config error instead of spending iterations.
- **Fail-safe by design.** Any unexpected error (missing/corrupt state, unreadable spec)
  lets the turn end normally — the hook never traps you in the loop.
- **`Esc` always aborts.**

`max_spend_usd` is **advisory in v1** — a Stop hook has no reliable in-session spend
figure. Use `max_iterations` to bound cost.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Loop stops immediately with a "check errored / misconfigured" message | A command in `checks` isn't runnable in this repo. Fix the command (check `package.json` / `Makefile`). |
| It keeps looping and never says done | The critic still finds issues or a check keeps failing. Watch `.loop/state.json`; tighten the goal or relax an over-strict quality bar. Hits `max_iterations` eventually regardless. |
| Hook seems to fire in normal (non-loop) sessions | Expected — with no active loop the gate returns instantly and does nothing. Disable the plugin in `/plugin` if you want it fully off. |
| `/loop:run` says no spec found | Run `/loop:new <name>` first, or pass the right name. |
| Install fails: `Validation errors: agents: Invalid input` | The manifest must not point `agents`/`skills` at a directory — remove those keys so they auto-discover. See the manifest note in **Install**. |
| Plugin error: `Duplicate hooks file detected … hooks/hooks.json` | The manifest has a `hooks` key while `hooks/hooks.json` is also auto-loaded. Remove the `hooks` key, then clean-reinstall (see **Install**). |

---

## How it's built

| Path | Responsibility |
|------|----------------|
| `skills/new/SKILL.md` | `/loop:new` — interview + scaffold a spec |
| `skills/run/SKILL.md` | `/loop:run` — drive the in-session build→critique loop |
| `agents/loop-critic.md` | independent adversarial reviewer subagent |
| `hooks/hooks.json` | registers the `Stop` hook |
| `bin/loop-gate.mjs` | Stop-hook entry point: runs checks, calls the decider, persists state |
| `lib/spec.mjs` | zero-dependency spec parser |
| `lib/state.mjs` | loop state (init / load / save, fail-safe) |
| `lib/gate.mjs` | pure decision engine (done / cap / stall / halt / block) |

Zero runtime dependencies. Tests use Node's built-in runner:

```bash
npm test
```

---

## Contributing

Contributions are welcome. A few conventions keep this codebase predictable:

- **Zero runtime dependencies.** The gate runs inside a Stop hook on every turn; it must
  stay fast and dependency-free. Tests use the built-in `node --test` runner.
- **The gate logic is pure and tested.** `lib/gate.mjs` (`decide`) does no I/O — all the
  decision logic lives there with thorough unit tests. `bin/loop-gate.mjs` is the thin
  I/O wrapper. Add behavior to the pure layer with a test first.
- **Safety invariants belong in the engine, not the prompts.** Termination (the
  `max_iterations` cap on gate-owned evaluations), the criteria ratchet, and fail-safe
  exits are enforced in code so they don't depend on the model behaving.
- **Don't add component paths to `.claude-plugin/plugin.json`** — see the manifest note
  under [Install](#install).

To propose a change: open an issue describing the behavior, then a PR with tests. Run
`npm test` before pushing.

---

## License

[MIT](LICENSE) © chuhaobing

---

⭐ If `loop` saves you from prompt-by-prompt babysitting, **star the repo** — it helps
other engineers find it.
