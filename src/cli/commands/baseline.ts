/**
 * `ra11y baseline <action>` — subcommand namespace for managing the
 * on-disk baseline file. Today only `prune` lives here (removes
 * entries whose files have been deleted). create/check/update live
 * under `--baseline <mode>` on the scan command.
 */

import { join, relative } from "node:path";
import {
  BASELINE_FILENAME,
  type BaselineEntry,
  loadBaseline,
  pruneBaseline,
  writeBaseline,
} from "../../engine/baseline.ts";
import type { CliOptions } from "../args.ts";
import type { ScanExit } from "./scan.ts";

const EXIT_OK = 0;
const EXIT_USER_ERROR = 2;

/** Routes `ra11y baseline <action>` to the matching handler. */
export function runBaselineCommand(options: CliOptions): Promise<ScanExit> {
  if (options.baselineAction === "prune") return runBaselinePrune(options);
  return Promise.resolve({
    stdout: "",
    stderr: `ra11y: unknown baseline action '${options.baselineAction ?? ""}'. Supported: prune.\n`,
    exitCode: EXIT_USER_ERROR,
  });
}

/**
 * `ra11y baseline prune` — drops entries whose file paths no longer
 * exist and rewrites the file. With `--dry-run`, reports without
 * mutating. Exit 0 on success (including zero-stale); exit 2 when
 * the baseline is missing or malformed.
 */
async function runBaselinePrune(options: CliOptions): Promise<ScanExit> {
  const cwd = process.cwd();
  const path = options.baselineFile ?? join(cwd, BASELINE_FILENAME);
  const displayPath = relative(cwd, path) || path;

  let baseline: Awaited<ReturnType<typeof loadBaseline>>;
  try {
    baseline = await loadBaseline(path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: `ra11y: failed to parse baseline at ${displayPath}: ${message}\n`,
      exitCode: EXIT_USER_ERROR,
    };
  }
  if (baseline === null) {
    return {
      stdout: "",
      stderr: `ra11y: baseline file not found at ${displayPath}. Run \`ra11y baseline create\` first.\n`,
      exitCode: EXIT_USER_ERROR,
    };
  }

  const { removed, kept, pruned } = pruneBaseline(baseline, cwd);
  if (!options.baselineDryRun && removed.length > 0) await writeBaseline(path, pruned);

  return {
    stdout: renderPruneReport(removed, kept, displayPath, options.baselineDryRun),
    stderr: "",
    exitCode: EXIT_OK,
  };
}

function renderPruneReport(
  removed: readonly BaselineEntry[],
  kept: readonly BaselineEntry[],
  displayPath: string,
  dryRun: boolean,
): string {
  const prefix = dryRun ? "ra11y baseline prune (dry-run):" : "ra11y baseline prune:";
  const verb = removed.length === 0 ? "removed" : dryRun ? "would remove" : "removed";
  const lines = [
    `${prefix} ${verb} ${removed.length} dead entries (${kept.length} still live) in ${displayPath}`,
  ];
  for (const entry of removed) lines.push(`  - ${entry.filePath}  ${entry.ruleId}`);
  return `${lines.join("\n")}\n`;
}
