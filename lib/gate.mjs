// lib/gate.mjs
// Pure decision logic. No IO. Assumes an active loop (caller handles "no loop").
// Returns { action, reason, nextState }.
//   action: "done" | "cap" | "stall" | "halt" | "block"
//   "done"|"cap"|"stall"|"halt" => allow the Stop. "block" => block the Stop, feed `reason` to Claude.
//
// Termination guarantee: the gate owns `evaluations`, incremented on every fire. The
// cap is enforced on `evaluations` (not Claude's self-reported `iteration`), so the loop
// terminates after maxIterations turns even if Claude never updates its own counters.
// `done` is checked before `cap` so a delivery on the final allowed turn still wins.

function failSignature(checkResults, critic) {
  const failed = checkResults.filter((c) => !c.ok).map((c) => c.run).sort();
  const verdict = critic ? critic.verdict : "none";
  return JSON.stringify({ failed, verdict });
}

function feedback(failingChecks, critic) {
  const parts = [];
  if (failingChecks.length) {
    parts.push("Automated checks still failing:\n" + failingChecks.map((c) => `  - ${c.run}`).join("\n"));
  }
  if (critic && critic.verdict === "issues") {
    const items = critic.findings && critic.findings.length
      ? critic.findings
      : ["(critic reported issues but listed no specific findings — re-run the loop-critic for concrete items)"];
    parts.push("Critic found unresolved issues:\n" + items.map((f) => `  - ${f}`).join("\n"));
  }
  parts.push("Address these, increment the round in .loop/state.json, re-run the loop-critic, then end your turn. Do not ask the human for input.");
  return parts.join("\n\n");
}

export function decide({ state, spec, checkResults }) {
  const next = { ...state, lastChecks: checkResults, evaluations: (state.evaluations || 0) + 1 };

  const finish = (action, reason) => {
    next.active = false;
    next.history = [...(state.history || []), { iteration: state.iteration, evaluations: next.evaluations, result: action }];
    return { action, reason, nextState: next };
  };

  // 1) Config error: a check command errored (e.g. command-not-found).
  const errored = checkResults.filter((c) => c.errored);
  if (errored.length) {
    return finish(
      "halt",
      `A check command errored (misconfigured spec): ${errored.map((c) => c.run).join(", ")}. Fix the spec's checks and re-run /loop:run.`
    );
  }

  // 1b) Ratchet guard: acceptance criteria may only be added, never removed.
  if (state.criteriaCount != null && spec.criteriaCount < state.criteriaCount) {
    return finish(
      "halt",
      `Ratchet violation: acceptance criteria dropped from ${state.criteriaCount} to ${spec.criteriaCount}. Criteria may only be added, never removed. Restore them in the spec and re-run /loop:run.`
    );
  }
  next.criteriaCount = spec.criteriaCount;

  const criticFresh = !!state.lastCritic && state.lastCritic.iteration === state.iteration;
  const allPass = checkResults.every((c) => c.ok);
  const criticClean = criticFresh && state.lastCritic.verdict === "clean";
  const failingChecks = checkResults.filter((c) => !c.ok);
  // The acceptance bar grew during this round (new criteria appended). `state.evaluations >= 1`
  // means a prior gate fire already established the baseline, so this is a mid-loop grow — not
  // the engineer's initial bar on the first fire.
  const barGrew = state.criteriaCount != null && state.evaluations >= 1 && spec.criteriaCount > state.criteriaCount;

  // 2) Done — requires at least one completed round; delivery wins over the cap at the boundary.
  //    A round that grew the bar (`barGrew`) cannot be the one that finishes — the new criteria
  //    haven't been verified yet, so done is withheld regardless of the critic's verdict.
  if (state.iteration >= 1 && criticFresh && allPass && criticClean && !barGrew) {
    return finish(
      "done",
      `Delivered in ${state.iteration} iteration(s): all checks pass and the critic found no material issues.`
    );
  }

  // 3) Hard cap on gate evaluations — the termination guarantee, independent of Claude.
  if (next.evaluations >= spec.caps.maxIterations) {
    return finish(
      "cap",
      `Hit max_iterations (${spec.caps.maxIterations}) before delivering. Stopping (on_cap: ${spec.onCap}). Unresolved: ${failSignature(checkResults, state.lastCritic)}`
    );
  }

  // 3b) No real round has run yet (setup turn ended early). The cap above still bounds
  // a loop stuck here; otherwise tell Claude to actually start round 1.
  if (state.iteration < 1) {
    return {
      action: "block",
      reason: "No iterations have run yet. Start round 1: set iteration=1 in .loop/state.json, do the work, dispatch the loop-critic, record lastCritic.iteration=1, then end your turn.",
      nextState: next,
    };
  }

  // 3c) The bar grew this round — force a re-review round so the new criteria are actually
  // verified before the loop can finish. Prevents finishing on freshly-discovered criteria.
  if (barGrew) {
    return {
      action: "block",
      reason: `New acceptance criteria were added this round (count ${state.criteriaCount} → ${spec.criteriaCount}). A round that grows the bar can't be the one that finishes — address the new criteria, re-run the loop-critic, then end your turn.`,
      nextState: next,
    };
  }

  // 4) Critic must be fresh for the current round, else the round isn't complete (anti-cheat).
  if (!criticFresh) {
    return {
      action: "block",
      reason: `Run the loop-critic subagent for round ${state.iteration} and record its verdict in .loop/state.json (lastCritic.iteration must equal ${state.iteration}) before ending your turn.`,
      nextState: next,
    };
  }

  // 5) Stall detection (fresh critic, still failing).
  const sig = failSignature(checkResults, state.lastCritic);
  next.stallCount = sig === state.lastFailSig ? state.stallCount + 1 : 1;
  next.lastFailSig = sig;
  if (next.stallCount >= spec.caps.stallAfter) {
    return finish(
      "stall",
      `No progress for ${next.stallCount} rounds (same failures). Stopping to avoid burning budget. Unresolved: ${sig}`
    );
  }

  // 6) Otherwise keep going.
  return {
    action: "block",
    reason: feedback(failingChecks, state.lastCritic),
    nextState: next,
  };
}
