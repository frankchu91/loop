// lib/state.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function statePath(projectDir) {
  return join(projectDir, ".loop", "state.json");
}

export function initState(name, specPath) {
  return {
    name,
    specPath,
    active: true,
    iteration: 0,
    evaluations: 0,
    lastCritic: null,
    lastChecks: null,
    stallCount: 0,
    lastFailSig: null,
    history: [],
  };
}

export function loadState(projectDir) {
  try {
    return JSON.parse(readFileSync(statePath(projectDir), "utf8"));
  } catch {
    return null; // missing or corrupt -> fail safe
  }
}

export function saveState(projectDir, state) {
  mkdirSync(join(projectDir, ".loop"), { recursive: true });
  writeFileSync(statePath(projectDir), JSON.stringify(state, null, 2) + "\n");
}
