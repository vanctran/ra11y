#!/usr/bin/env bun
// PreToolUse hook for `git commit *`. Runs the full verification suite
// before the commit is allowed through. If any step fails, we block with
// a clear explanation so Claude can fix the underlying issue rather than
// bypass it. Never skip hooks. Never --no-verify.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readHookInput } from "./lib/input.ts";
import { block, ok } from "./lib/output.ts";
import { audit } from "./lib/audit.ts";
import type { PreToolUseInput } from "./lib/types.ts";

interface Check {
  label: string;
  command: string;
  required: () => boolean;
}

const input = await readHookInput<PreToolUseInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const hasPackageJson = existsSync(join(projectDir, "package.json"));
const hasNodeModules = existsSync(join(projectDir, "node_modules"));
const hasSrc = existsSync(join(projectDir, "src"));

// Extract the -m "..." commit message from the git command so we can
// validate the NEW message rather than the stale .git/COMMIT_EDITMSG.
// Supports -m, --message, -m "...", -m"...", and HEREDOC via $(cat <<EOF ... EOF).
const rawCommand = typeof input.tool_input.command === "string" ? input.tool_input.command : "";
const commitMessage = extractCommitMessage(rawCommand);

// We gate checks on whether their preconditions exist. Early phases don't
// have src/ yet — we don't want to block commits for "no tests found."
const checks: Check[] = [
  {
    label: "biome check",
    command: "bunx --bun biome check .",
    required: () => hasPackageJson && hasNodeModules,
  },
  {
    label: "tsc --noEmit",
    command: "bunx tsc --noEmit",
    required: () => hasPackageJson && hasNodeModules && hasSrc,
  },
  {
    label: "bun test",
    command: "bun test --bail",
    required: () => hasPackageJson && hasNodeModules && hasSrc,
  },
  {
    label: "scripts/check-zero-deps.ts",
    command: "bun scripts/check-zero-deps.ts",
    required: () => existsSync(join(projectDir, "scripts", "check-zero-deps.ts")),
  },
  {
    label: "scripts/check-commit.ts",
    command: "bun scripts/check-commit.ts",
    required: () => existsSync(join(projectDir, "scripts", "check-commit.ts")),
  },
];

const failures: string[] = [];
for (const check of checks) {
  if (!check.required()) continue;
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (commitMessage) env["RA11Y_COMMIT_MESSAGE"] = commitMessage;
  const result = spawnSync(check.command, {
    cwd: projectDir,
    shell: true,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    failures.push(`✗ ${check.label}\n${output}`);
  }
}

if (failures.length > 0) {
  audit({
    event: "PreToolUse:git-commit",
    action: "block",
    detail: { failureCount: failures.length },
  });
  block(
    `pre-commit verification failed — fix these and retry (do NOT --no-verify):\n\n${failures.join("\n\n")}`,
  );
}

audit({ event: "PreToolUse:git-commit", action: "allow" });
ok();

/**
 * Best-effort extraction of the commit message from a `git commit`
 * command. Handles:
 *   - git commit -m "subject"
 *   - git commit -m 'subject'
 *   - git commit --message "subject"
 *   - git commit -m "$(cat <<'EOF' ... EOF)" (heredoc)
 * Returns the message body (first line + rest) or null if no message
 * is embedded inline (e.g., `git commit` with an editor).
 */
function extractCommitMessage(cmd: string): string | null {
  // Match a heredoc: $(cat <<'EOF'\n...\nEOF) or $(cat <<EOF\n...\nEOF)
  const heredocMatch = /\$\(\s*cat\s+<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*\)/.exec(cmd);
  if (heredocMatch?.[2]) {
    return heredocMatch[2].trim();
  }

  // Match -m "..." or --message "..." with double-quoted body.
  const dq = /(?:^|\s)(?:-m|--message)\s+"([^"\\]*(?:\\.[^"\\]*)*)"/m.exec(cmd);
  if (dq?.[1]) return unescapeShell(dq[1]);

  // Single-quoted body.
  const sq = /(?:^|\s)(?:-m|--message)\s+'([^']*)'/m.exec(cmd);
  if (sq?.[1]) return sq[1];

  return null;
}

function unescapeShell(s: string): string {
  return s.replace(/\\(["\\$`])/g, "$1");
}
