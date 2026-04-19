/**
 * Canonical CLI exit codes. Every `ra11y` command returns one of these
 * values; nothing else. Freezing the enum at v1.0 means scripts grepping
 * `$?` stay correct across upgrades (CLAUDE.md §12 — exit-code semantics
 * are semver-major surface).
 *
 * Legend (also surfaced under `ra11y --help` and in `docs/cli.md`):
 *
 * - `OK` (0)         — success; no action required
 * - `VIOLATIONS` (1) — scan found failures that trip `--fail-on`, or a
 *                      command completed with user-visible problems
 *                      (doctor probe failures, init refusal)
 * - `USER_ERROR` (2) — unknown flag / unknown rule / unknown profile /
 *                      malformed arguments / missing required input
 * - `NEW_VIOLATIONS` (3) — `--diff` mode only: baseline check discovered
 *                      violations absent from the baseline (scan passed
 *                      against a dirty baseline would be exit 0)
 */
export const ExitCode = {
  OK: 0,
  VIOLATIONS: 1,
  USER_ERROR: 2,
  NEW_VIOLATIONS: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Human-readable legend rendered under `ra11y --help` and kept in sync
 * with the {@link ExitCode} enum. Update both together.
 */
export const EXIT_CODE_LEGEND: readonly { readonly code: ExitCode; readonly label: string }[] = [
  { code: ExitCode.OK, label: "success; no action required" },
  { code: ExitCode.VIOLATIONS, label: "violations found, or command-specific failures" },
  { code: ExitCode.USER_ERROR, label: "invalid arguments / unknown rule / unknown profile" },
  { code: ExitCode.NEW_VIOLATIONS, label: "diff mode: new violations vs baseline" },
];
