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
