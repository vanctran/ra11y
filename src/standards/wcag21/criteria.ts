/**
 * WCAG 2.1 success criteria as pure data, derived from the WCAG 2.2
 * row table minus the 9 criteria introduced in 2.2. Same descriptions
 * for the shared 78 SCs — the normative wording did not change for
 * any pre-existing criterion between 2.1 and 2.2.
 *
 * The notable override is 4.1.1 Parsing: in 2.1 it's an active
 * criterion, while in 2.2 it's obsolete (always satisfies). We ship
 * the 2.1 description verbatim for the 2.1 version so users targeting
 * 2.1 get the expected text.
 *
 * equivalentTo: every 2.1 criterion lists its wcag22 equivalent. The
 * reciprocal is handled by the criteria-registry's closure builder,
 * so wcag22 criteria automatically see wcag21 equivalents too.
 *
 * Source: https://www.w3.org/TR/WCAG21/
 */

import type { Criterion } from "../../types/standard.ts";
import { WCAG22_ROWS, type WcagRow } from "../wcag22/criteria.ts";
import { wcag21Url } from "./metadata.ts";

/** Local IDs of the criteria added in WCAG 2.2 — these are NOT in 2.1. */
const NEW_IN_WCAG22: ReadonlySet<string> = new Set([
  "2.4.11", // Focus Not Obscured (Minimum)
  "2.4.12", // Focus Not Obscured (Enhanced)
  "2.4.13", // Focus Appearance
  "2.5.7", // Dragging Movements
  "2.5.8", // Target Size (Minimum)
  "3.2.6", // Consistent Help
  "3.3.7", // Redundant Entry
  "3.3.8", // Accessible Authentication (Minimum)
  "3.3.9", // Accessible Authentication (Enhanced)
]);

/** Overrides applied when 2.1 wording differs from 2.2. */
const OVERRIDES: Readonly<Record<string, Partial<WcagRow>>> = {
  "4.1.1": {
    title: "Parsing",
    description:
      "In content implemented using markup languages, elements have complete start and end tags, are nested according to specifications, do not contain duplicate attributes, and IDs are unique, except where the specifications allow these features.",
    // Active in WCAG 2.1 — still best-effort manual, but not obsolete.
    automatable: "manual",
  },
};

const ROWS_21: readonly WcagRow[] = WCAG22_ROWS.filter((row) => !NEW_IN_WCAG22.has(row.id)).map(
  (row) => {
    const override = OVERRIDES[row.id];
    if (!override) return row;
    return { ...row, ...override };
  },
);

/** All 78 WCAG 2.1 success criteria as `Criterion` records. */
export const WCAG21_CRITERIA: readonly Criterion[] = ROWS_21.map((row) => {
  const equivalentTo = [`wcag22:${row.id}`];
  return {
    id: `wcag21:${row.id}`,
    standardId: "wcag21",
    localId: row.id,
    title: row.title,
    level: row.level,
    description: row.description,
    url: wcag21Url(row.slug),
    automatable: row.automatable,
    equivalentTo,
  };
});
