/**
 * EN 301 549 v3.2.1 clause 9 (Web) criteria.
 *
 * Clause 9 incorporates WCAG 2.1 Level A and AA by reference, with a
 * one-to-one mapping between EN 301 549 9.X.Y.Z and WCAG 2.1 X.Y.Z.
 * Criterion 9.1.1.1 in EN 301 549 is WCAG 2.1 1.1.1, and so on.
 *
 * The data is derived from the shared WCAG row table (which contains
 * exactly the 78 criteria present in both WCAG 2.1 and 2.2), filtered
 * to Level A + AA only.
 *
 * What remains is WCAG 2.1 Level A + AA — 50 criteria total.
 */

import type { Criterion } from "../../types/standard.ts";
import { SHARED_WCAG_ROWS } from "../wcag-shared/rows.ts";

const WCAG_21_AA_ROWS = SHARED_WCAG_ROWS.filter((row) => row.level === "A" || row.level === "AA");

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
