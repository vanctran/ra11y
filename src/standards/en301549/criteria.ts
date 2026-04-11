/**
 * EN 301 549 v3.2.1 clause 9 (Web) criteria.
 *
 * Clause 9 incorporates WCAG 2.1 Level A and AA by reference, with a
 * one-to-one mapping between EN 301 549 9.X.Y.Z and WCAG 2.1 X.Y.Z.
 * Criterion 9.1.1.1 in EN 301 549 is WCAG 2.1 1.1.1, and so on.
 *
 * The data is derived from the WCAG 2.2 row table minus:
 *   - the 9 criteria introduced in WCAG 2.2 (not in 2.1)
 *   - every Level AAA criterion (EN 301 549 only requires A+AA)
 *
 * What remains is WCAG 2.1 Level A + AA — 50 criteria total.
 */

import type { Criterion } from "../../types/standard.ts";
import { WCAG22_ROWS } from "../wcag22/criteria.ts";

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

const WCAG_21_AA_ROWS = WCAG22_ROWS.filter(
  (row) => !NEW_IN_WCAG22.has(row.id) && (row.level === "A" || row.level === "AA"),
);

export const EN301549_CRITERIA: readonly Criterion[] = WCAG_21_AA_ROWS.map((row) => ({
  // EN 301 549 numbers its web clause as 9.X.Y.Z where X.Y.Z is the
  // WCAG SC ID — e.g., EN 9.1.1.1 is WCAG 1.1.1, EN 9.1.4.3 is WCAG 1.4.3.
  id: `en301549:9.${row.id}`,
  standardId: "en301549",
  localId: `9.${row.id}`,
  title: row.title,
  level: "base",
  description: row.description,
  url: "https://www.etsi.org/deliver/etsi_en/301500_301599/301549/",
  automatable: row.automatable,
  equivalentTo: [`wcag22:${row.id}`],
}));
