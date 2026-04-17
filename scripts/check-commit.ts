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
 *   - reviewable size: staged diff (excluding generated kb, fixtures,
 *     lockfiles) ≤ 400 net lines; `chore(kb):` prefix is exempt. Set
 *     RA11Y_COMMIT_ALLOW_OVERSIZE=1 to acknowledge a legitimately
 *     large commit (large refactors, new standards).
 *
 * Exits 0 on success, 1 on violation.
 */

import { execSync, spawnSync } from "node:child_process";
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
const MAX_REVIEWABLE_LINES = 400;
const DIFFSTAT_EXCLUDES: readonly RegExp[] = [
  /^docs\/kb\//,
  /^tests\/fixtures\//,
  /^bun\.lock$/,
  /^bun\.lockb$/,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^\.claude\/history\.jsonl$/,
];

const message = readCommitMessage();
const firstLine = message.split("\n")[0] ?? "";

const violations: string[] = [];

// Parse `<type>(<scope>)?: <subject>` or `<type>(<scope>)?!: <subject>` for breaking.
const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(firstLine);
if (match) {
  const [, type, scope, , subject] = match;
  if (!(type && ALLOWED_TYPES.has(type))) {
    violations.push(`type '${type}' is not in the allowed set (${[...ALLOWED_TYPES].join(", ")})`);
  }
  if (type && SCOPE_REQUIRED.has(type) && !scope) {
    violations.push(`type '${type}' requires a scope like '${type}(engine): …'`);
  }
  if (
    subject &&
    subject.length > MAX_SUBJECT_LENGTH - (type?.length ?? 0) - (scope?.length ?? 0) - 4
  ) {
    // Approximate — real budget is full line ≤ 72, not subject alone.
  }
  if (firstLine.length > MAX_SUBJECT_LENGTH) {
    violations.push(`subject line is ${firstLine.length} characters — max ${MAX_SUBJECT_LENGTH}`);
  }
  if (subject && /^[A-Z]/.test(subject)) {
    violations.push(`subject starts with an uppercase letter — should start lowercase`);
  }
  if (subject?.endsWith(".")) {
    violations.push(`subject ends with a period — should not`);
  }
} else {
  violations.push(`subject does not match '<type>(<scope>)?: <subject>' — got: '${firstLine}'`);
}

if (violations.length > 0) {
  console.error(`✗ commit message does not follow ra11y convention:\n`);
  console.error(`  message: ${firstLine}\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n  format: <type>(<scope>): <subject>`);
  console.error(`  types:  ${[...ALLOWED_TYPES].join(", ")}`);
  console.error(`  example: feat(rules): add contrast/minimum for wcag22:1.4.3`);
  process.exit(1);
}

const typePrefix = match?.[1] ?? "";
const scope = match?.[2] ?? "";
const sizeViolation = checkReviewableSize(typePrefix, scope);
if (sizeViolation) {
  console.error(sizeViolation);
  process.exit(1);
}

console.log("✓ commit message: passes conventional format");
process.exit(0);

function checkReviewableSize(type: string, scope: string): string | null {
  // chore(kb) is the canonical "regenerated" commit — exempt by design.
  if (type === "chore" && scope === "kb") return null;
  // Explicit opt-out for legitimately large commits.
  if (process.env.RA11Y_COMMIT_ALLOW_OVERSIZE === "1") return null;
  const netLines = countStagedDiffLines();
  if (netLines === null) return null; // not a git context (e.g. running in CI on a ref)
  if (netLines <= MAX_REVIEWABLE_LINES) return null;
  return [
    `✗ commit exceeds reviewable-size cap: ${netLines} net lines (cap ${MAX_REVIEWABLE_LINES})`,
    "",
    "  excluded from the count: docs/kb/, tests/fixtures/, lockfiles, audit log.",
    "  split the commit by concern (skeleton / logic / tests / fixtures / kb) or",
    "  set RA11Y_COMMIT_ALLOW_OVERSIZE=1 to acknowledge a legitimately large change.",
  ].join("\n");
}

function countStagedDiffLines(): number | null {
  const result = spawnSync("git", ["diff", "--cached", "--numstat"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  let total = 0;
  for (const line of result.stdout.split("\n")) {
    const match = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line);
    if (!match) continue;
    const added = match[1] === "-" ? 0 : Number.parseInt(match[1] ?? "0", 10);
    const removed = match[2] === "-" ? 0 : Number.parseInt(match[2] ?? "0", 10);
    const path = match[3] ?? "";
    if (DIFFSTAT_EXCLUDES.some((re) => re.test(path))) continue;
    total += added + removed;
  }
  return total;
}

function readCommitMessage(): string {
  // Priority 1: explicit file path passed as argv[2]. The real git
  // commit-msg hook at .githooks/commit-msg invokes us this way —
  // git passes the pending message file path as $1.
  const argvPath = process.argv[2];
  if (argvPath && existsSync(argvPath)) {
    return readFileSync(argvPath, "utf8");
  }

  // Priority 2: env-var override set by the Claude Code pre-commit hook.
  // The hook extracts -m "..." from the git-commit command line and
  // passes it through so the check sees the NEW message.
  const override = process.env.RA11Y_COMMIT_MESSAGE;
  if (override && override.trim().length > 0) return override;

  // Priority 3: standard .git/COMMIT_EDITMSG path. STALE in the
  // PreToolUse context (contains the last committed message, not the
  // new one) — the hooks above bypass it when possible.
  if (existsSync(EDIT_MSG_PATH)) {
    return readFileSync(EDIT_MSG_PATH, "utf8");
  }

  // Priority 4: post-commit / manual invocation fallback.
  try {
    return execSync("git log -1 --pretty=%B", { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.error("commit-check: could not read commit message");
    process.exit(1);
  }
}
