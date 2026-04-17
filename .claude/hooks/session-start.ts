#!/usr/bin/env bun

// SessionStart hook. Injects a project dashboard as additionalContext so
// every new session starts with an accurate snapshot: branch, ship state,
// active-track progress, rule/standard counts, last test run, recent
// commits.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import { getProjectState, renderTrackLine } from "./lib/project-state.ts";
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

if (state.shipState) {
  lines.push("│ ship state:");
  if (state.shipState.v010) lines.push(`│   v0.1.0 — ${state.shipState.v010}`);
  if (state.shipState.v020) lines.push(`│   v0.2.0 — ${state.shipState.v020}`);
  if (state.shipState.v030) lines.push(`│   v0.3.0+ — ${state.shipState.v030}`);
  lines.push("│");
}

const activeTracks = state.trackProgress.filter((t) => t.total > 0 && t.done < t.total);
if (activeTracks.length > 0) {
  lines.push("│ active tracks:");
  for (const track of activeTracks) {
    lines.push(`│   ${renderTrackLine(track)}`);
  }
  lines.push("│");
}

if (state.lastCommits.length > 0) {
  lines.push("│ recent commits:");
  for (const c of state.lastCommits) lines.push(`│   ${c}`);
  lines.push("│");
}
lines.push("│ reminder: zero deps · every rule cites WCAG · never skip /verify");
lines.push("│ dispatch: /continue picks one item per active track and fans out up to 3 agents");
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
