#!/usr/bin/env bun

// PreToolUse hook. Fires for tool calls matching the `if` patterns in
// .claude/settings.json. For truly dangerous patterns (git push --force,
// git reset --hard, rm -rf src/, rm -rf .claude/) we block unconditionally.
// For sensitive-but-legitimate edits (package.json, .claude/settings.json)
// we require an explicit confirmation marker in the new content.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { block, ok } from "./lib/output.ts";
import type { PreToolUseInput } from "./lib/types.ts";

const input = await readHookInput<PreToolUseInput>();

// Hard-blocked Bash patterns. These never have a legitimate automated use.
const HARD_BLOCK_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /^git\s+push\s+.*--force/,
    reason:
      "refusing: `git push --force` rewrites shared history. If you really need to force-push, do it manually in your shell.",
  },
  {
    regex: /^git\s+reset\s+.*--hard/,
    reason:
      "refusing: `git reset --hard` destroys uncommitted work. Diagnose what went wrong and stage a fix commit instead.",
  },
  {
    regex: /^rm\s+-rf\s+.*\bsrc\b/,
    reason: "refusing: wholesale `rm -rf src/` is never the answer. Delete specific files.",
  },
  {
    regex: /^rm\s+-rf\s+.*\.claude\b/,
    reason:
      "refusing: `.claude/` is the autonomous-development infrastructure. Removing it leaves the repo unrunnable.",
  },
  {
    regex: /--no-verify\b/,
    reason:
      "refusing: `--no-verify` skips hooks. Fix the underlying failure instead of bypassing the gate.",
  },
];

// Edits to sensitive files that need a confirmation marker in the new content.
const CONFIRMATION_MARKER = "// CLAUDE-CODE: confirmed";
const SENSITIVE_EDIT_PATHS = ["package.json", ".claude/settings.json"];

if (input.tool_name === "Bash") {
  const command = String(input.tool_input.command ?? "");
  for (const { regex, reason } of HARD_BLOCK_PATTERNS) {
    if (regex.test(command)) {
      audit({ event: "PreToolUse", action: "block", detail: { tool: "Bash", command, reason } });
      block(reason);
    }
  }
}

if (input.tool_name === "Edit" || input.tool_name === "Write") {
  const filePath = String(input.tool_input.file_path ?? "");
  const newContent = String(input.tool_input.new_string ?? input.tool_input.content ?? "");
  const isSensitive = SENSITIVE_EDIT_PATHS.some((p) => filePath.endsWith(p));
  if (isSensitive && !newContent.includes(CONFIRMATION_MARKER)) {
    audit({
      event: "PreToolUse",
      action: "block-sensitive",
      detail: { tool: input.tool_name, file: filePath },
    });
    block(
      `refusing: ${filePath} requires an explicit confirmation marker. Add a line '${CONFIRMATION_MARKER}' to your change (or ask the user to make the edit manually).`,
    );
  }
}

ok();
