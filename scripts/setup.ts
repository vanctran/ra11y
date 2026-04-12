#!/usr/bin/env bun
/**
 * One-shot contributor setup.
 *
 * Sets `core.hooksPath` to the tracked `.githooks/` directory so that
 * every clone of the ra11y repo uses the version-controlled hooks.
 * Also makes the hooks executable (some filesystems lose the bit on
 * checkout).
 *
 * Idempotent: run it as many times as you like.
 *
 * Usage: `bun run setup` after cloning.
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HOOKS_DIR = join(ROOT, ".githooks");

function run(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

function ensureGitRepo(): void {
  try {
    run("git rev-parse --show-toplevel");
  } catch {
    console.error("ra11y setup: not inside a git repository.");
    process.exit(1);
  }
}

function ensureHooksDir(): void {
  if (!existsSync(HOOKS_DIR)) {
    console.error(`ra11y setup: .githooks/ directory is missing at ${HOOKS_DIR}.`);
    console.error("                 run this script from the repo root.");
    process.exit(1);
  }
}

function setHooksPath(): void {
  const current = safeRun("git config --local core.hooksPath");
  if (current === ".githooks") {
    console.log("  ✓ core.hooksPath already = .githooks");
    return;
  }
  run('git config --local core.hooksPath ".githooks"');
  console.log("  ✓ core.hooksPath = .githooks");
}

function safeRun(cmd: string): string | null {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function makeExecutable(): void {
  const hooks = ["pre-commit", "commit-msg"];
  for (const name of hooks) {
    const path = join(HOOKS_DIR, name);
    if (!existsSync(path)) continue;
    const mode = 0o755;
    chmodSync(path, mode);
    console.log(`  ✓ chmod +x .githooks/${name}`);
  }
}

function testBun(): void {
  try {
    const version = run("bun --version");
    console.log(`  ✓ bun ${version} on PATH`);
  } catch {
    console.error("  ✗ bun is not on PATH. Install from https://bun.sh");
    process.exit(1);
  }
}

function main(): void {
  console.log("ra11y contributor setup:");
  ensureGitRepo();
  ensureHooksDir();
  testBun();
  setHooksPath();
  makeExecutable();
  console.log("");
  console.log("  Setup complete. The next `git commit` will run:");
  console.log("    - .githooks/pre-commit  → bun run verify:precommit");
  console.log("    - .githooks/commit-msg  → bun scripts/check-commit.ts");
  console.log("");
  console.log("  Never use --no-verify. See CLAUDE.md section 11.");
}

main();
