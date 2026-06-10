// test/spec.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec } from "../lib/spec.mjs";

const SAMPLE = `---
max_iterations: 12
max_spend_usd: 5
stall_after: 3
critic: subagent
on_cap: stop_and_report
checks:
  - run: npm test
  - run: npm run build
---

# Goal
Wire the login page to the real backend API.

# Quality bar
- [ ] Clear error states, no blank screens
- [ ] Responsive at mobile widths
`;

test("parses caps", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.caps.maxIterations, 12);
  assert.equal(s.caps.maxSpendUsd, 5);
  assert.equal(s.caps.stallAfter, 3);
});

test("parses checks as list of {run}", () => {
  const s = parseSpec(SAMPLE);
  assert.deepEqual(s.checks, [{ run: "npm test" }, { run: "npm run build" }]);
});

test("parses critic and onCap", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.critic, "subagent");
  assert.equal(s.onCap, "stop_and_report");
});

test("extracts goal and criteria sections", () => {
  const s = parseSpec(SAMPLE);
  assert.match(s.goal, /login page to the real backend/);
  assert.match(s.criteria, /Responsive at mobile widths/);
});

test("applies defaults when fields omitted", () => {
  const s = parseSpec(`---\nchecks:\n  - run: npm test\n---\n# Goal\nx\n`);
  assert.equal(s.caps.maxIterations, 20);
  assert.equal(s.caps.stallAfter, 3);
  assert.equal(s.caps.maxSpendUsd, null);
  assert.equal(s.critic, "subagent");
  assert.equal(s.onCap, "stop_and_report");
});

test("throws on missing frontmatter", () => {
  assert.throws(() => parseSpec("# Goal\nno frontmatter\n"), /frontmatter/i);
});
