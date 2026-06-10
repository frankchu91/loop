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
