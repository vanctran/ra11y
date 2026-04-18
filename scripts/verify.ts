#!/usr/bin/env bun
/**
 * Single entrypoint for verification. This is the ONLY place that
 * names the full check sequence; CI, the pre-commit hook, and the
 * /verify skill all call `bun run verify` (or `verify:precommit`).
 *
 * Execution model: every check runs concurrently with the others,
 * but the result lines print in declared CHECKS order as each
 * prefix completes. This gives fast wall-clock time (bounded by
 * the slowest single check) while keeping the output readable —
 * you always see `typecheck` before `test` before `kb-drift`.
 *
 * Precommit mode (`--precommit`) adds a scope-filter layer: each
 * check declares an `affectedBy(changed)` predicate; if no changed
 * file in the working tree matches, the check is skipped. This
 * keeps the dev-loop cost proportional to diff size. The full
 * `bun run verify` (no flag) is byte-identical to pre-scope behavior
 * — CI and prepublishOnly rely on that determinism.
 *
 * Adding a new check: add an entry to CHECKS. Don't add a
 * package.json alias — nobody calls these individually. Skills and
 * hooks that want to run one check directly can `bun scripts/<name>.ts`.
 */

import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  describeScope,
  FULL_SENTINEL,
  hasAnyTsChange,
  hasApiChange,
  hasDepsChange,
  hasDocsMdChange,
  hasSrcTsChange,
  hasTestOrSrcChange,
} from "./verify-scope.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const TSBUILDINFO = join(ROOT, "node_modules/.cache/ra11y/tsbuildinfo");

interface Check {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly precommit: boolean;
  readonly full: boolean;
  /**
   * Returns true when the check should run given the set of changed
   * paths (relative to repo root). Only consulted in --precommit mode.
   * Absent → always runs (conservative default for checks whose scope
   * is the whole repo, like `limits`).
   */
  readonly affectedBy?: (changed: ReadonlySet<string>) => boolean;
  /**
   * Optional precommit-only command override. Used by `typecheck` to
   * enable incremental compilation against a cached buildinfo. Full
   * `bun run verify` always uses `cmd` to keep CI deterministic.
   */
  readonly precommitCmd?: readonly string[];
}

const CHECKS: readonly Check[] = [
  {
    name: "typecheck",
    cmd: ["bunx", "tsc", "--noEmit"],
    precommitCmd: ["bunx", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", TSBUILDINFO],
    precommit: true,
    full: true,
    affectedBy: hasAnyTsChange,
  },
  {
    name: "lint",
    cmd: ["bunx", "--bun", "biome", "check", "."],
    precommit: true,
    full: true,
    affectedBy: hasAnyTsChange,
  },
  {
    name: "test",
    cmd: ["bun", "test"],
    precommit: true,
    full: true,
    affectedBy: hasTestOrSrcChange,
  },
  {
    name: "zero-deps",
    cmd: ["bun", "scripts/check-zero-deps.ts"],
    precommit: true,
    full: true,
    affectedBy: hasDepsChange,
  },
  {
    name: "network-isolation",
    cmd: ["bun", "scripts/check-network-isolation.ts"],
    precommit: true,
    full: true,
    affectedBy: hasSrcTsChange,
  },
  {
    name: "limits",
    cmd: ["bun", "scripts/check-limits.ts"],
    precommit: true,
    full: true,
  },
  {
    name: "cycles",
    cmd: ["bun", "scripts/check-cycles.ts"],
    precommit: true,
    full: true,
    affectedBy: hasSrcTsChange,
  },
  {
    name: "error-messages",
    cmd: ["bun", "scripts/check-error-messages.ts"],
    precommit: true,
    full: true,
    affectedBy: hasSrcTsChange,
  },
  {
    name: "tsdoc",
    cmd: ["bun", "scripts/check-tsdoc.ts"],
    precommit: true,
    full: true,
    affectedBy: hasApiChange,
  },
  {
    name: "mermaid",
    cmd: ["bun", "scripts/check-mermaid.ts"],
    precommit: true,
    full: true,
    affectedBy: hasDocsMdChange,
  },
  { name: "docs-links", cmd: ["bun", "scripts/check-docs-links.ts"], precommit: false, full: true },
  { name: "kb-drift", cmd: ["bun", "scripts/check-kb-drift.ts"], precommit: false, full: true },
];

const precommit = process.argv.includes("--precommit");
const selected = CHECKS.filter((c) => (precommit ? c.precommit : c.full));

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly skipped?: boolean;
}

const start = Date.now();
const changed = precommit ? getChangedFiles() : null;
const scopeNote = precommit ? describeScope(changed) : "";

const runs: Promise<Result>[] = selected.map((c) => dispatch(c, changed));

const results: Result[] = [];
const failures: string[] = [];
let skippedCount = 0;
for (let i = 0; i < runs.length; i++) {
  const pending = runs[i];
  if (!pending) continue;
  const r = await pending;
  results.push(r);
  const suffix = r.skipped ? `skipped (${r.ms}ms)` : r.ok ? `ok (${r.ms}ms)` : `FAIL (${r.ms}ms)`;
  process.stdout.write(`→ ${r.name.padEnd(20)} ${suffix}\n`);
  if (r.skipped) skippedCount += 1;
  if (!(r.ok || r.skipped)) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    failures.push(r.name);
  }
}

const total = Date.now() - start;
if (failures.length > 0) {
  console.error(`\n✗ verify failed: ${failures.join(", ")}  (${total}ms)`);
  process.exit(1);
}
const ran = selected.length - skippedCount;
const summary = precommit
  ? `${ran} ran · ${skippedCount} skipped · ${total}ms${scopeNote ? ` · ${scopeNote}` : ""}`
  : `${selected.length} checks · ${total}ms`;
console.log(`\n✓ verify passed  (${summary})`);

function dispatch(check: Check, changed: ReadonlySet<string> | null): Promise<Result> {
  if (changed !== null && check.affectedBy && !check.affectedBy(changed)) {
    return Promise.resolve({
      name: check.name,
      ok: true,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    });
  }
  const cmd = changed !== null && check.precommitCmd ? check.precommitCmd : check.cmd;
  return run(check.name, cmd);
}

function run(name: string, cmd: readonly string[]): Promise<Result> {
  return new Promise((resolve) => {
    const checkStart = Date.now();
    const child = spawn(cmd[0] ?? "", cmd.slice(1), {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({
        name,
        ok: code === 0,
        ms: Date.now() - checkStart,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      resolve({
        name,
        ok: false,
        ms: Date.now() - checkStart,
        stdout,
        stderr: `${stderr}${err.message}\n`,
      });
    });
  });
}

/**
 * Returns the set of paths (relative to ROOT) that differ from HEAD
 * in the working tree — both staged and unstaged. Untracked files are
 * included via `--others --exclude-standard` so a newly-added rule
 * file counts even before it's `git add`-ed.
 *
 * Falls back to "run everything" (FULL_SENTINEL) when git isn't
 * available or the repo is in a weird state.
 */
function getChangedFiles(): ReadonlySet<string> {
  const diff = runGit(["diff", "--name-only", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  const combined = `${diff}\n${untracked}`;
  const files = new Set<string>();
  for (const line of combined.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed);
  }
  if (files.size === 0) {
    process.stdout.write(
      "→ verify:precommit     no changes detected, running full precommit set\n",
    );
    return FULL_SENTINEL;
  }
  return files;
}

function runGit(args: readonly string[]): string {
  const r = spawnSync("git", args as string[], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "") : "";
}
