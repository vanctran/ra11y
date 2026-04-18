/**
 * Baseline-presence probe for `scan_project` (Track Q / P2-BASE).
 *
 * An agent running a scan wants to know whether a `.ra11y-baseline.json`
 * is in play BEFORE it proposes fixes — otherwise it may re-propose
 * work that was deliberately grandfathered. Today that requires a
 * separate `baseline check` call; this helper lets `scan_project`
 * surface the state in the same response so the agent gets the signal
 * for free.
 *
 * Returns `null` when no baseline file exists at the canonical path
 * (the scan_project response omits the field in that case — per
 * CLAUDE.md §1 "Ambiguous field shapes are dishonest," present-only-
 * when-meaningful). Returns `{ exists: true, path, lastModified }`
 * when the file is on disk and stat-able. Stat errors (permissions,
 * symlink loops) read the same as "no baseline" — the tool-baseline
 * surface is the right place for detailed diagnostics.
 *
 * The helper does NOT read or parse the file — presence + mtime is
 * enough signal. Parsing happens in `baseline check` / `scan_diff`.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { BASELINE_FILENAME } from "../engine/baseline.ts";

export interface BaselineStatus {
  readonly exists: true;
  readonly path: string;
  /** ISO-8601 timestamp of the baseline file's last mtime. */
  readonly lastModified: string;
}

export async function probeBaselineStatus(cwd: string): Promise<BaselineStatus | null> {
  const path = join(cwd, BASELINE_FILENAME);
  try {
    const s = await stat(path);
    return { exists: true, path, lastModified: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

/**
 * Conditional-spread the `baselineStatus` meta field — present only
 * when a `.ra11y-baseline.json` exists at the scan root. Lets callers
 * spread unconditionally and keeps their cognitive complexity inside
 * the lint budget.
 */
export function baselineStatusField(status: BaselineStatus | null): {
  readonly baselineStatus?: BaselineStatus;
} {
  if (status === null) return {};
  return { baselineStatus: status };
}
