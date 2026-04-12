#!/usr/bin/env bun
// UserPromptSubmit hook. Injects a compact state header into every prompt
// so the model always has current branch, phase progress, and test status
// without re-asking. Kept under ~15 lines so it doesn't crowd the prompt.

import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import { getProjectState } from "./lib/project-state.ts";
import type { UserPromptSubmitInput } from "./lib/types.ts";

const input = await readHookInput<UserPromptSubmitInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const state = getProjectState(projectDir);

const phases = state.phaseProgress.filter((p) => p.total > 0 && p.done < p.total).slice(0, 3);
const phaseStr =
  phases.length > 0
    ? phases.map((p) => `${p.name.replace(/^Phase /, "P")}: ${p.done}/${p.total}`).join(" · ")
    : "all phases complete";

const testStr = state.testStatus
  ? state.testStatus.failing === 0
    ? `tests ${state.testStatus.passing}✓`
    : `tests ${state.testStatus.failing}✗`
  : "tests —";

const header = [
  `[ra11y] ${state.branch}${state.dirty ? `·${state.dirtyCount}dirty` : ""} · rules ${state.ruleCount} · standards ${state.standardCount} · ${testStr}`,
  `[ra11y] ${phaseStr}`,
].join("\n");

ok({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: header,
  },
});
