/**
 * Section 508 (2017 refresh) criteria.
 *
 * The 2017 refresh incorporates WCAG 2.0 Level A and AA by reference
 * via E205.4. For per-SC reporting (what VPATs need), ra11y models
 * Section 508 as one criterion per WCAG 2.0 A+AA SC, with each
 * criterion's `equivalentTo` pointing at its `wcag22:` counterpart
 * (which also covers `wcag21:` via the registry's transitive
 * closure).
 *
 * The filter below reuses the WCAG 2.2 row data and excludes:
 *   - the 9 criteria introduced in WCAG 2.2
 *   - the 17 criteria introduced in WCAG 2.1
 *   - every Level AAA criterion (Section 508 only requires A+AA)
 *
 * What remains is WCAG 2.0 Level A + AA — 38 criteria total.
 */

import type { Criterion } from "../../types/standard.ts";
import { WCAG22_ROWS } from "../wcag22/criteria.ts";

/** Local IDs of criteria added in WCAG 2.1 — NOT part of WCAG 2.0. */
const NEW_IN_WCAG21: ReadonlySet<string> = new Set([
  "1.3.4",
  "1.3.5",
  "1.3.6",
  "1.4.10",
  "1.4.11",
  "1.4.12",
  "1.4.13",
  "2.1.4",
  "2.2.6",
  "2.3.3",
  "2.5.1",
  "2.5.2",
  "2.5.3",
  "2.5.4",
  "2.5.5",
  "2.5.6",
  "4.1.3",
]);

/** Local IDs of criteria added in WCAG 2.2 — NOT part of WCAG 2.0 or 2.1. */
const NEW_IN_WCAG22: ReadonlySet<string> = new Set([
  "2.4.11",
  "2.4.12",
  "2.4.13",
  "2.5.7",
  "2.5.8",
  "3.2.6",
  "3.3.7",
  "3.3.8",
  "3.3.9",
]);

const WCAG_20_AA_ROWS = WCAG22_ROWS.filter(
  (row) =>
    !NEW_IN_WCAG22.has(row.id) &&
    !NEW_IN_WCAG21.has(row.id) &&
    (row.level === "A" || row.level === "AA"),
);

export const SECTION508_CRITERIA: readonly Criterion[] = WCAG_20_AA_ROWS.map((row) => ({
  id: `section508:${row.id}`,
  standardId: "section508",
  localId: row.id,
  title: row.title,
  level: "base",
  description: row.description,
  url: `https://www.access-board.gov/ict/#E205.4`,
  automatable: row.automatable,
  equivalentTo: [`wcag22:${row.id}`],
}));
