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
 * Adding a new check: add an entry to CHECKS. Don't add a
 * package.json alias — nobody calls these individually. Skills and
 * hooks that want to run one check directly can `bun scripts/<name>.ts`.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");

interface Check {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly precommit: boolean;
  readonly full: boolean;
}

const CHECKS: readonly Check[] = [
  { name: "typecheck", cmd: ["bunx", "tsc", "--noEmit"], precommit: true, full: true },
  { name: "lint", cmd: ["bunx", "--bun", "biome", "check", "."], precommit: true, full: true },
  { name: "test", cmd: ["bun", "test"], precommit: true, full: true },
  { name: "zero-deps", cmd: ["bun", "scripts/check-zero-deps.ts"], precommit: true, full: true },
  {
    name: "network-isolation",
    cmd: ["bun", "scripts/check-network-isolation.ts"],
    precommit: true,
    full: true,
  },
  { name: "limits", cmd: ["bun", "scripts/check-limits.ts"], precommit: true, full: true },
  { name: "cycles", cmd: ["bun", "scripts/check-cycles.ts"], precommit: true, full: true },
  {
    name: "error-messages",
    cmd: ["bun", "scripts/check-error-messages.ts"],
    precommit: true,
    full: true,
  },
  { name: "tsdoc", cmd: ["bun", "scripts/check-tsdoc.ts"], precommit: true, full: true },
  { name: "mermaid", cmd: ["bun", "scripts/check-mermaid.ts"], precommit: true, full: true },
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
}

const start = Date.now();
const runs: Promise<Result>[] = selected.map(run);

// Stream output in declared order: await each in sequence. Checks
// that finish early just wait their turn to be printed. Checks that
// are still running when their slot comes up block the printer —
// but since we printed everything before them already, the user
// sees progress smoothly.
const results: Result[] = [];
const failures: string[] = [];
for (let i = 0; i < runs.length; i++) {
  const pending = runs[i];
  if (!pending) continue;
  const r = await pending;
  results.push(r);
  const suffix = r.ok ? `ok (${r.ms}ms)` : `FAIL (${r.ms}ms)`;
  process.stdout.write(`→ ${r.name.padEnd(20)} ${suffix}\n`);
  if (!r.ok) {
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
console.log(`\n✓ verify passed  (${selected.length} checks · ${total}ms)`);

function run(check: Check): Promise<Result> {
  return new Promise((resolve) => {
    const checkStart = Date.now();
    const child = spawn(check.cmd[0] ?? "", check.cmd.slice(1), {
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
        name: check.name,
        ok: code === 0,
        ms: Date.now() - checkStart,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      resolve({
        name: check.name,
        ok: false,
        ms: Date.now() - checkStart,
        stdout,
        stderr: `${stderr}${err.message}\n`,
      });
    });
  });
}
