/**
 * Barrel export for ra11y's shared type system.
 *
 * All types under `src/` are re-exported from this single module so that
 * intra-repo imports don't fan out across dozens of deep paths. This is
 * the single source of truth — if you want to change a type, change it
 * here (or in the file it lives in) and the whole codebase follows.
 */

export type {
  Automatability,
  Criterion,
  Standard,
} from "./standard.ts";

export type {
  CoverageEntry,
  Fix,
  Location,
  ReportData,
  ScanResult,
  Severity,
  Violation,
} from "./violation.ts";
