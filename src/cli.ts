#!/usr/bin/env node
/**
 * ra11y CLI binary entry point. Thin wrapper over src/cli/run.ts so
 * the bulk of the CLI is unit-testable without spawning a process.
 */

import { runCli } from "./cli/run.ts";

async function main(): Promise<void> {
  const { stdout, stderr, exitCode } = await runCli(process.argv.slice(2));
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ra11y: ${message}\n`);
  process.exit(2);
});
