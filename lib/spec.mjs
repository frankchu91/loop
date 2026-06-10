// lib/spec.mjs
// Minimal, dependency-free parser for the loop spec format:
// YAML-subset frontmatter (scalars + a `checks:` list of `- run: <cmd>`) plus markdown body.

const DEFAULTS = {
  maxIterations: 20,
  maxSpendUsd: null,
  stallAfter: 3,
  critic: "subagent",
  onCap: "stop_and_report",
};

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("Spec is missing YAML frontmatter (--- ... ---).");
  return { fm: m[1], body: m[2] };
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(fm) {
  const lines = fm.split("\n");
  const scalars = {};
  const checks = [];
  let inChecks = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (/^checks:\s*$/.test(line)) { inChecks = true; continue; }
    if (inChecks && /^\s*-\s*run:\s*/.test(line)) {
      checks.push({ run: line.replace(/^\s*-\s*run:\s*/, "").trim() });
      continue;
    }
    if (/^\S/.test(line) && line.includes(":")) {
      inChecks = false;
      const idx = line.indexOf(":");
      scalars[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
    }
  }
  return { scalars, checks };
}

function getSection(body, headingRe) {
  const lines = body.split("\n");
  let capturing = false;
  const out = [];
  for (const line of lines) {
    const h = line.match(/^#\s+(.*)$/);
    if (h) {
      if (capturing) break;
      capturing = headingRe.test(h[1]);
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

export function parseSpec(text) {
  text = text.replace(/\r\n/g, "\n");
  const { fm, body } = splitFrontmatter(text);
  const { scalars, checks } = parseFrontmatter(fm);
  return {
    caps: {
      maxIterations: scalars.max_iterations ?? DEFAULTS.maxIterations,
      maxSpendUsd: scalars.max_spend_usd ?? DEFAULTS.maxSpendUsd,
      stallAfter: scalars.stall_after ?? DEFAULTS.stallAfter,
    },
    checks,
    critic: scalars.critic ?? DEFAULTS.critic,
    onCap: scalars.on_cap ?? DEFAULTS.onCap,
    goal: getSection(body, /goal/i),
    criteria: getSection(body, /quality|done|acceptance|criteria/i),
  };
}
