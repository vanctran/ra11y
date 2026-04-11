#!/usr/bin/env node
/**
 * ra11y CLI binary entry point.
 *
 * This file is intentionally thin — it delegates to `src/cli/run.ts` so
 * that all CLI internals (arg parsing, help rendering, command dispatch)
 * live in one place that's easy to test in isolation. Do not add logic
 * here. If you need a flag, add it to `src/cli/args.ts`.
 *
 * v0.0.x: not yet implemented. See `.claude/backlog.md` Phase 8.
 */

async function main(): Promise<void> {
  process.stderr.write(
    "ra11y: the CLI is not implemented yet. See .claude/backlog.md Phase 8.\n",
  );
  process.exit(2);
}

await main();
