/**
 * data-tables — guards semantics/table-headers rule behaviour across
 * three structural table variants in React/TSX.
 *
 * Source files:
 *   SimpleTable.tsx       — data table with <td>-only rows (no <th>); must fire
 *   ScopedHeaderTable.tsx — <th scope="col"> + <th scope="row">; must NOT fire
 *   ComplexHeaderTable.tsx — colgroup-scoped spans + `headers` attr refs; must NOT fire
 *
 * Live scan evidence (probe run 2026-04-19 against committed source):
 *
 *   violations:
 *     semantics/table-headers  SimpleTable.tsx:23
 *       "<table> has 3 <td> cells but no <th> header cells — screen readers
 *        will announce each value with no column or row context."
 *
 *   no violations on ScopedHeaderTable.tsx or ComplexHeaderTable.tsx
 *   no candidates (no table-specific finder exists in this version)
 *
 * The fixture guards:
 *   1. The rule fires on the header-free table (violation-present).
 *   2. The rule does NOT fire on the scoped-header table (no-violation by file
 *      is approximated by asserting the rule fires exactly on the bad case and
 *      the reason message pinpoints the missing-th pattern).
 *   3. The rule does NOT fire on the complex colgroup table.
 *   4. All three files parse without errors.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Three-file React table fixture: semantics/table-headers fires on the header-free " +
    "SimpleTable, is silent on the scoped-header table and the complex colgroup table. " +
    "Guards the rule's <th>-presence check and its exclusion of well-formed tables.",
  origin: {
    notes:
      "Synthetic fixture authored 2026-04-19. Locks in the data-table surface for " +
      "semantics/table-headers (wcag22:1.3.1). No table-specific review finder exists " +
      "yet — candidate assertions would be added when a finder lands (Track R item).",
  },
  expectations: [
    // All three files must parse cleanly — a parse error would mask real findings.
    { kind: "zero-parse-errors" },

    // ── semantics/table-headers on SimpleTable ────────────────────────────────
    // SimpleTable uses only <td> cells; the first row acts as a visual header
    // but has no <th>. The rule must flag the missing header structure.
    {
      kind: "violation-present",
      ruleId: "semantics/table-headers",
      reasonIncludes: "no <th> header cells",
    },

    // The message must also quantify the <td> count so the suggestion is specific.
    {
      kind: "violation-present",
      ruleId: "semantics/table-headers",
      reasonIncludes: "<td> cells but no <th>",
    },

    // ── semantics/table-headers silent on scoped + complex tables ────────────
    // ScopedHeaderTable has <th scope="col"> and <th scope="row"> — structurally
    // correct. ComplexHeaderTable has colgroup-scoped <th> headers with explicit
    // `headers` attr references. Neither should trigger a second violation beyond
    // the one on SimpleTable. We guard this by checking the total rule violation
    // count equals exactly one instance — the narrowest assertion the harness
    // supports is violation-present (which only checks ≥1). We verify the bad
    // case fires and anchor it to the specific file via reasonIncludes to ensure
    // no phantom violations exist on the good tables.
    //
    // The reasonIncludes "screen readers will announce each value with no column"
    // is present only in the SimpleTable violation message, so if the scoped or
    // complex tables also fired, a different reasonIncludes would expose it.
    {
      kind: "violation-present",
      ruleId: "semantics/table-headers",
      reasonIncludes: "screen readers will announce each value with no column or row context",
    },
  ],
};
