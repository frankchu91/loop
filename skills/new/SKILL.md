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
