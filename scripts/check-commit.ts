#!/usr/bin/env bun
/**
 * Conventional-commit validator. Reads the commit message from (in
 * priority order):
 *
 *   1. $RA11Y_COMMIT_MESSAGE (set by .claude/hooks/pre-commit.ts when
 *      the hook extracts the -m argument from the git-commit command)
 *   2. .git/COMMIT_EDITMSG (a normal commit-msg hook path; note that
 *      during PreToolUse this file is STALE — it contains the last
 *      committed message, not the pending one)
 *   3. `git log -1 --pretty=%B` (manual invocation after a commit)
 *
 * Rules:
 *   - Subject: <type>(<scope>)?: <subject>
 *   - type ∈ {feat, fix, chore, docs, refactor, test, perf, build, ci}
 *   - scope required for feat, fix, refactor
 *   - subject length ≤ 72 chars
 *   - subject starts with lowercase letter
 *   - no trailing period on subject
 *
 * Exits 0 on success, 1 on violation.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const EDIT_MSG_PATH = join(ROOT, ".git", "COMMIT_EDITMSG");

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "perf",
  "build",
  "ci",
]);
const SCOPE_REQUIRED = new Set(["feat", "fix", "refactor"]);
const MAX_SUBJECT_LENGTH = 72;

const message = readCommitMessage();
const firstLine = message.split("\n")[0] ?? "";

const violations: string[] = [];

// Parse `<type>(<scope>)?: <subject>` or `<type>(<scope>)?!: <subject>` for breaking.
const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(firstLine);
if (!match) {
  violations.push(
    `subject does not match '<type>(<scope>)?: <subject>' — got: '${firstLine}'`,
  );
} else {
  const [, type, scope, , subject] = match;
  if (!type || !ALLOWED_TYPES.has(type)) {
    violations.push(
      `type '${type}' is not in the allowed set (${[...ALLOWED_TYPES].join(", ")})`,
    );
  }
  if (type && SCOPE_REQUIRED.has(type) && !scope) {
    violations.push(`type '${type}' requires a scope like '${type}(engine): …'`);
  }
  if (subject && subject.length > MAX_SUBJECT_LENGTH - (type?.length ?? 0) - (scope?.length ?? 0) - 4) {
    // Approximate — real budget is full line ≤ 72, not subject alone.
  }
  if (firstLine.length > MAX_SUBJECT_LENGTH) {
    violations.push(
      `subject line is ${firstLine.length} characters — max ${MAX_SUBJECT_LENGTH}`,
    );
  }
  if (subject && /^[A-Z]/.test(subject)) {
    violations.push(`subject starts with an uppercase letter — should start lowercase`);
  }
  if (subject?.endsWith(".")) {
    violations.push(`subject ends with a period — should not`);
  }
}

if (violations.length > 0) {
  console.error(`✗ commit message does not follow ra11y convention:\n`);
  console.error(`  message: ${firstLine}\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    `\n  format: <type>(<scope>): <subject>`,
  );
  console.error(`  types:  ${[...ALLOWED_TYPES].join(", ")}`);
  console.error(`  example: feat(rules): add contrast/minimum for wcag22:1.4.3`);
  process.exit(1);
}

console.log("✓ commit message: passes conventional format");
process.exit(0);

function readCommitMessage(): string {
  // Priority 1: env-var override set by the pre-commit hook.
  const override = process.env.RA11Y_COMMIT_MESSAGE;
  if (override && override.trim().length > 0) return override;

  // Priority 2: standard commit-msg path. In our PreToolUse context
  // this is STALE (contains the last committed message, not the new
  // one). The pre-commit hook bypasses this via the env var above.
  if (existsSync(EDIT_MSG_PATH)) {
    return readFileSync(EDIT_MSG_PATH, "utf8");
  }

  // Priority 3: post-commit / manual invocation fallback.
  try {
    return execSync("git log -1 --pretty=%B", { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.error("commit-check: could not read commit message");
    process.exit(1);
  }
}
