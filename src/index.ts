/**
 * ra11y public programmatic API.
 *
 * This is the entry point consumers reach via:
 *
 * ```ts
 * import { scan } from "@ra11y/core";
 * ```
 *
 * Everything exported from this file is part of the public contract.
 * Renaming or removing an export is a breaking change (see CLAUDE.md
 * section 14 for the semver policy).
 *
 * v0.0.x is a scaffold: the types are stable, the runtime functions
 * are not yet implemented. See `.claude/backlog.md` for current phase.
 */

export type {
  Criterion,
  ReportData,
  ScanResult,
  Severity,
  Standard,
  Violation,
} from "./types/index.ts";

/**
 * Runs an accessibility scan against a set of file paths.
 *
 * @param options - Scan configuration. The shape will stabilize in Phase 8.
 * @returns A {@link ScanResult} with violations grouped per file.
 *
 * @example
 * ```ts
 * import { scan } from "@ra11y/core";
 * const result = await scan({ paths: ["src/"], standards: ["wcag22"] });
 * ```
 */
export async function scan(_options: ScanOptions): Promise<import("./types/index.ts").ScanResult> {
  throw new Error(
    "ra11y scan() is not implemented yet — see .claude/backlog.md Phase 7–8.",
  );
}

export interface ScanOptions {
  readonly paths: readonly string[];
  readonly standards?: readonly string[];
  readonly level?: "A" | "AA" | "AAA";
}
