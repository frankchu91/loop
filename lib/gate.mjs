// lib/gate.mjs
// Pure decision logic. No IO. Assumes an active loop (caller handles "no loop").
// Returns { action, reason, nextState }.
//   action: "done" | "cap" | "stall" | "halt" | "block"
//   "done"|"cap"|"stall"|"halt" => allow the Stop. "block" => block the Stop, feed `reason` to Claude.

function failSignature(checkResults, critic) {
  const failed = checkResults.filter((c) => !c.ok).map((c) => c.run).sort();
  const verdict = critic ? critic.verdict : "none";
  return JSON.stringify({ failed, verdict });
}

function feedback(failingChecks, findings) {
  const parts = [];
  if (failingChecks.length) {
    parts.push("Automated checks still failing:\n" + failingChecks.map((c) => `  - ${c.run}`).join("\n"));
  }
  if (findings && findings.length) {
    parts.push("Critic found unresolved issues:\n" + findings.map((f) => `  - ${f}`).join("\n"));
  }
  parts.push("Address these, increment the round in .loop/state.json, re-run the loop-critic, then end your turn. Do not ask the human for input.");
  return parts.join("\n\n");
}

export function decide({ state, spec, checkResults }) {
  const next = { ...state, lastChecks: checkResults };

  // 1) Config error: a check command errored (e.g. command-not-found).
  const errored = checkResults.filter((c) => c.errored);
  if (errored.length) {
    next.active = false;
    return {
      action: "halt",
      reason: `A check command errored (misconfigured spec): ${errored.map((c) => c.run).join(", ")}. Fix the spec's checks and re-run /loop:run.`,
      nextState: next,
    };
  }

  // 2) Critic must be fresh for the current round, else the round isn't complete.
  if (!state.lastCritic || state.lastCritic.iteration !== state.iteration) {
    return {
      action: "block",
      reason: `Run the loop-critic subagent for round ${state.iteration} and record its verdict in .loop/state.json (lastCritic.iteration must equal ${state.iteration}) before ending your turn.`,
      nextState: next,
    };
  }

  const allPass = checkResults.every((c) => c.ok);
  const criticClean = state.lastCritic.verdict === "clean";
  const failingChecks = checkResults.filter((c) => !c.ok);

  // 3) Done.
  if (allPass && criticClean) {
    next.active = false;
    next.history = [...state.history, { iteration: state.iteration, result: "done" }];
    return {
      action: "done",
      reason: `Delivered in ${state.iteration} iteration(s): all checks pass and the critic found no material issues.`,
      nextState: next,
    };
  }

  // 4) Iteration cap.
  if (state.iteration >= spec.caps.maxIterations) {
    next.active = false;
    return {
      action: "cap",
      reason: `Hit max_iterations (${spec.caps.maxIterations}) before delivering. Stopping (on_cap: ${spec.onCap}). Unresolved: ${failSignature(checkResults, state.lastCritic)}`,
      nextState: next,
    };
  }

  // 5) Stall detection.
  const sig = failSignature(checkResults, state.lastCritic);
  next.stallCount = sig === state.lastFailSig ? state.stallCount + 1 : 1;
  next.lastFailSig = sig;
  if (next.stallCount >= spec.caps.stallAfter) {
    next.active = false;
    return {
      action: "stall",
      reason: `No progress for ${next.stallCount} rounds (same failures). Stopping to avoid burning budget. Unresolved: ${sig}`,
      nextState: next,
    };
  }

  // 6) Otherwise keep going.
  return {
    action: "block",
    reason: feedback(failingChecks, state.lastCritic.findings),
    nextState: next,
  };
}
