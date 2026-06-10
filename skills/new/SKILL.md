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
