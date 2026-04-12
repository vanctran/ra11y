#!/usr/bin/env bun

// SessionStart hook. Injects a project dashboard as additionalContext so
// every new session starts with an accurate snapshot: branch, backlog
// progress, rule/standard counts, last test run, and recent commits.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import { getProjectState, renderPhaseLine } from "./lib/project-state.ts";
import type { SessionStartInput } from "./lib/types.ts";

const input = await readHookInput<SessionStartInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const state = getProjectState(projectDir);

const lines: string[] = [];
lines.push("╭─ ra11y session dashboard ───────────────────────────────────");
lines.push(`│ branch: ${state.branch}${state.dirty ? ` · ${state.dirtyCount} dirty` : " · clean"}`);
lines.push(`│ rules: ${state.ruleCount} implemented · standards: ${state.standardCount} loaded`);
if (state.testStatus) {
  const ts = state.testStatus;
  const status = ts.failing === 0 ? "passing" : `${ts.failing} failing`;
  lines.push(`│ tests: ${ts.passing} ${status} · ${ts.durationMs}ms · ${ts.timestamp}`);
} else {
  lines.push(`│ tests: (no run recorded — .claude/test-status.json missing)`);
}
lines.push("│");
if (state.phaseProgress.length > 0) {
  lines.push("│ backlog:");
  for (const phase of state.phaseProgress.slice(0, 6)) {
    lines.push(`│   ${renderPhaseLine(phase)}`);
  }
  if (state.phaseProgress.length > 6) {
    lines.push(`│   … ${state.phaseProgress.length - 6} more phases`);
  }
  lines.push("│");
}
if (state.lastCommits.length > 0) {
  lines.push("│ recent commits:");
  for (const c of state.lastCommits) lines.push(`│   ${c}`);
  lines.push("│");
}
lines.push("│ reminder: zero deps · every rule cites WCAG · never skip /verify");
lines.push("╰──────────────────────────────────────────────────────────────");

audit({
  event: "SessionStart",
  action: "dashboard",
  detail: { source: input.source, rules: state.ruleCount, standards: state.standardCount },
});

ok({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: lines.join("\n"),
  },
});
