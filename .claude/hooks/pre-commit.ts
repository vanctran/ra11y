#!/usr/bin/env bun
// PreToolUse hook for `git commit *`. Runs a scoped verification pass
// before the commit is allowed through:
//   - biome check on staged source files only
//   - tsc --noEmit on the whole project when any .ts/.tsx is staged
//   - check-zero-deps when package.json or bun.lock is staged
//   - check-commit (conventional message format) always
//
// Deliberately NOT run here:
//   - `bun test --bail`: the post-edit hook runs targeted tests on every
//     Edit/Write, and CI runs the full suite on push. Re-running the whole
//     suite on every commit duplicates both.
//   - biome check on the whole repo: pre-commit should protect the
//     changes being committed, not block on unrelated drift.
//
// If the command turns out not to be a git commit (the `if` filter in
// settings.json should scope this hook, but be defensive), we exit 0.
// Never --no-verify.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { block, ok } from "./lib/output.ts";
import type { PreToolUseInput } from "./lib/types.ts";

interface Check {
  label: string;
  command: string;
  required: () => boolean;
}

const input = await readHookInput<PreToolUseInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const rawCommand = typeof input.tool_input.command === "string" ? input.tool_input.command : "";

// Defensive: only run checks when the command is actually a git commit.
// The settings.json `if` filter should already scope this, but if a
// future matcher change sends non-commit Bash through here, we shouldn't
// silently gate every command on the commit pipeline.
if (!/\bgit\s+commit\b/.test(rawCommand)) {
  ok();
  process.exit(0);
}

const hasPackageJson = existsSync(join(projectDir, "package.json"));
const hasNodeModules = existsSync(join(projectDir, "node_modules"));
const hasSrc = existsSync(join(projectDir, "src"));

const stagedFiles = getStagedFiles(projectDir);
// Only the paths biome.json includes — src/, tests/, scripts/, and
// .claude/hooks/. Anything else (e.g. integrations/, which is a
// sibling project with its own toolchain) is intentionally outside
// biome's scope and would make `biome check` fail with "no files
// processed" if passed explicitly.
const BIOME_SCOPED = /^(src|tests|scripts|\.claude\/hooks)\//;
const stagedTsFiles = stagedFiles.filter((f) => /\.(ts|tsx|cts|mts)$/.test(f));
const stagedLintTargets = stagedFiles.filter(
  (f) => /\.(ts|tsx|cts|mts|js|jsx|json|jsonc)$/.test(f) && BIOME_SCOPED.test(f),
);
const stagedTsFilesInProject = stagedTsFiles.filter((f) => BIOME_SCOPED.test(f));
const stagedPackageManifest = stagedFiles.some(
  (f) => f === "package.json" || f === "bun.lock" || f === "bun.lockb",
);

const commitMessage = extractCommitMessage(rawCommand);

const checks: Check[] = [
  {
    label: `biome check (${stagedLintTargets.length} staged file${stagedLintTargets.length === 1 ? "" : "s"})`,
    command: `bunx --bun biome check ${stagedLintTargets.map(shellEscape).join(" ")}`,
    required: () => hasPackageJson && hasNodeModules && stagedLintTargets.length > 0,
  },
  {
    label: "tsc --noEmit",
    command: "bunx tsc --noEmit",
    required: () => hasPackageJson && hasNodeModules && hasSrc && stagedTsFilesInProject.length > 0,
  },
  {
    label: "scripts/check-zero-deps.ts",
    command: "bun scripts/check-zero-deps.ts",
    required: () =>
      stagedPackageManifest && existsSync(join(projectDir, "scripts", "check-zero-deps.ts")),
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
  if (commitMessage) env.RA11Y_COMMIT_MESSAGE = commitMessage;
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

function getStagedFiles(cwd: string): string[] {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function shellEscape(path: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

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
  const heredocMatch = /\$\(\s*cat\s+<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*\)/.exec(cmd);
  if (heredocMatch?.[2]) {
    return heredocMatch[2].trim();
  }

  const dq = /(?:^|\s)(?:-m|--message)\s+"([^"\\]*(?:\\.[^"\\]*)*)"/m.exec(cmd);
  if (dq?.[1]) return unescapeShell(dq[1]);

  const sq = /(?:^|\s)(?:-m|--message)\s+'([^']*)'/m.exec(cmd);
  if (sq?.[1]) return sq[1];

  return null;
}

function unescapeShell(s: string): string {
  return s.replace(/\\(["\\$`])/g, "$1");
}
