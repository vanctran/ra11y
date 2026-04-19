/**
 * WCAG 2.2 success criteria as pure data.
 *
 * All 87 success criteria defined by WCAG 2.2. Source:
 * https://www.w3.org/TR/WCAG22/
 *
 * The 78 criteria shared with WCAG 2.1 live in `wcag-shared/rows.ts`.
 * This file adds the 9 criteria new in WCAG 2.2 and combines them
 * into the full WCAG22_ROWS array (87 total). The shared 4.1.1 row
 * already carries the "Obsolete in WCAG 2.2" wording, which is
 * correct for this standard.
 *
 * `automatable` classifications reflect what we can statically check:
 *   - full:     the rule implementation catches every conformance failure
 *   - partial:  the rule catches a meaningful subset; the rest needs manual audit
 *   - manual:   no static check is possible; the criterion requires human judgment
 *
 * `equivalentTo` entries cross-map to WCAG 2.1 and (where applicable) WCAG 2.0.
 * Section 508 and EN 301 549 equivalents are added on those standards' side
 * so this file stays self-contained for WCAG 2.2 readers.
 */

import type { Criterion } from "../../types/standard.ts";
import { SHARED_WCAG_ROWS, type WcagRow } from "../wcag-shared/rows.ts";
import { wcag22Url } from "./metadata.ts";

// Re-export WcagRow so existing consumers can still import it from here.
export type { WcagRow } from "../wcag-shared/rows.ts";

/** The 9 success criteria introduced in WCAG 2.2 (not present in 2.1). */
const NEW_IN_WCAG22: readonly WcagRow[] = [
  {
    id: "2.4.11",
    title: "Focus Not Obscured (Minimum)",
    level: "AA",
    slug: "focus-not-obscured-minimum",
    description:
      "When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content.",
    automatable: "manual",
  },
  {
    id: "2.4.12",
    title: "Focus Not Obscured (Enhanced)",
    level: "AAA",
    slug: "focus-not-obscured-enhanced",
    description:
      "When a user interface component receives keyboard focus, no part of the component is hidden by author-created content.",
    automatable: "manual",
  },
  {
    id: "2.4.13",
    title: "Focus Appearance",
    level: "AAA",
    slug: "focus-appearance",
    description:
      "When the keyboard focus indicator is visible, the focus indication has sufficient size and contrast.",
    automatable: "manual",
  },
  {
    id: "2.5.7",
    title: "Dragging Movements",
    level: "AA",
    slug: "dragging-movements",
    description:
      "All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging.",
    automatable: "partial",
  },
  {
    id: "2.5.8",
    title: "Target Size (Minimum)",
    level: "AA",
    slug: "target-size-minimum",
    description: "The size of the target for pointer inputs is at least 24 by 24 CSS pixels.",
    automatable: "partial",
  },
  {
    id: "3.2.6",
    title: "Consistent Help",
    level: "A",
    slug: "consistent-help",
    description:
      "If a web page contains any of the following help mechanisms, and those mechanisms are repeated on multiple web pages within a set of web pages, they occur in the same order relative to other page content.",
    automatable: "manual",
  },
  {
    id: "3.3.7",
    title: "Redundant Entry",
    level: "A",
    slug: "redundant-entry",
    description:
      "Information previously entered by or provided to the user that is required to be entered again in the same process is auto-populated or available for the user to select.",
    automatable: "manual",
  },
  {
    id: "3.3.8",
    title: "Accessible Authentication (Minimum)",
    level: "AA",
    slug: "accessible-authentication-minimum",
    description:
      "A cognitive function test is not required for any step in an authentication process unless an alternative is provided or the test is object recognition or personal content.",
    automatable: "manual",
  },
  {
    id: "3.3.9",
    title: "Accessible Authentication (Enhanced)",
    level: "AAA",
    slug: "accessible-authentication-enhanced",
    description:
      "A cognitive function test is not required for any step in an authentication process unless an alternative is provided or the test is object recognition.",
    automatable: "manual",
  },
];

/** Compare two WCAG SC IDs numerically (e.g., "2.4.11" vs "2.5.1"). */
function compareScId(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * All 86 WCAG 2.2 rows — the shared 78 minus 4.1.1 (removed from the
 * spec in 2.2) plus the 9 new in 2.2, sorted into SC-number order.
 *
 * 4.1.1 Parsing was deprecated in WCAG 2.2 because modern parsers
 * recover from the errors it flagged. A criterion that "always
 * satisfies" shouldn't appear in a manual-review checklist — users
 * targeting wcag22 would have to triage a no-op.
 *
 * The shared row still exists for wcag21 (where 4.1.1 is live) and
 * for downstream standards whose equivalentTo edges point at
 * wcag21:4.1.1 (Section 508, EN 301 549).
 */
export const WCAG22_ROWS: readonly WcagRow[] = [
  ...SHARED_WCAG_ROWS.filter((row) => row.id !== "4.1.1"),
  ...NEW_IN_WCAG22,
].sort((a, b) => compareScId(a.id, b.id));

/**
 * WCAG 2.2 success criteria as `Criterion` records, ready to register
 * into the standards/criteria registries. Excludes 4.1.1 (removed in 2.2);
 * includes the nine new 2.2 criteria.
 */
export const WCAG22_CRITERIA: readonly Criterion[] = WCAG22_ROWS.map((row) => ({
  id: `wcag22:${row.id}`,
  standardId: "wcag22",
  localId: row.id,
  title: row.title,
  level: row.level,
  description: row.description,
  url: wcag22Url(row.slug),
  automatable: row.automatable,
  ...(row.equivalentTo !== undefined && { equivalentTo: row.equivalentTo }),
}));
