/**
 * Unit tests for `titlesForCriteria`.
 *
 * Guards the documented invariants:
 *   - Positional alignment: `criteriaTitles[i]` is the title of `criteria[i]`.
 *   - Fallback: unresolved IDs become the ID itself (never empty string).
 *   - Empty-in → empty-out (no sentinel values injected).
 *
 * These invariants are load-bearing — every finding surface relies on
 * same-index alignment so PR-body composition and human-readable reports
 * can zip `criteria` with `criteriaTitles` without a second lookup. A
 * regression here silently rewrites titles against the wrong IDs.
 */

import { describe, expect, it } from "bun:test";
import { titlesForCriteria } from "../../../src/utils/criteria-titles.ts";

describe("titlesForCriteria", () => {
  it("resolves a known criterion ID to its title", () => {
    const titles = titlesForCriteria(["wcag22:2.4.5"], (id) =>
      id === "wcag22:2.4.5" ? "Multiple Ways" : undefined,
    );
    expect(titles).toEqual(["Multiple Ways"]);
  });

  it("preserves index alignment for multiple criteria in mixed order", () => {
    // Order is deliberately *not* alphabetical — if the helper sorted
    // internally, the `zip` with the caller's criteria array would mis-map.
    const table = new Map<string, string>([
      ["wcag22:2.4.5", "Multiple Ways"],
      ["wcag21:2.4.5", "Multiple Ways"],
      ["wcag22:1.1.1", "Non-text Content"],
    ]);
    const input = ["wcag22:1.1.1", "wcag22:2.4.5", "wcag21:2.4.5"];
    const titles = titlesForCriteria(input, (id) => table.get(id));
    expect(titles).toEqual(["Non-text Content", "Multiple Ways", "Multiple Ways"]);
    // Explicit zip check: titles[i] must be the title of input[i].
    for (let i = 0; i < input.length; i++) {
      const expected = table.get(input[i] ?? "") ?? input[i];
      expect(titles[i]).toBe(expected ?? "");
    }
  });

  it("falls back to the criterion ID (never empty string) when the lookup returns undefined", () => {
    // CLAUDE.md §1 "Ambiguous field shapes are dishonest": an empty
    // string would let a downstream consumer silently render a blank
    // title. The ID is always a non-empty, deterministic fallback.
    const titles = titlesForCriteria(["wcag22:9.9.9"], () => undefined);
    expect(titles).toEqual(["wcag22:9.9.9"]);
    expect(titles[0]).not.toBe("");
  });

  it("falls back to the criterion ID when the lookup returns empty string", () => {
    // A lookup that returns "" is the same failure mode as undefined —
    // still dishonest to emit. Treat both as "no title available."
    const titles = titlesForCriteria(["wcag22:1.1.1"], () => "");
    expect(titles).toEqual(["wcag22:1.1.1"]);
  });

  it("returns an empty array for empty input", () => {
    // Every surface is documented to carry `criteriaTitles: []` when
    // `criteria: []` — the empty-in/empty-out case is the honest shape.
    const titles = titlesForCriteria([], () => "should never be called");
    expect(titles).toEqual([]);
  });

  it("mixes resolved and unresolved IDs without shifting alignment", () => {
    const titles = titlesForCriteria(["wcag22:2.4.5", "wcag22:9.9.9", "wcag22:1.1.1"], (id) =>
      id === "wcag22:2.4.5"
        ? "Multiple Ways"
        : id === "wcag22:1.1.1"
          ? "Non-text Content"
          : undefined,
    );
    expect(titles).toEqual(["Multiple Ways", "wcag22:9.9.9", "Non-text Content"]);
  });
});
