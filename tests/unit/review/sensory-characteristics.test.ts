/**
 * Unit tests for the review/sensory-characteristics finder (wcag22:1.3.3).
 *
 * Regex-based accuracy suite. The directional-verb pattern handles
 * polysemous words like "view" that are noun in prose ("the view above")
 * but verb as instruction ("view above to continue") — the former is
 * not a 1.3.3 concern and must not fire.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/sensory-characteristics.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/sensory-characteristics", () => {
  it("flags imperative 'see above' / 'click below'", () => {
    for (const phrase of ["see above", "click below", "tap above to continue"]) {
      const source = `<p>${phrase}</p>`;
      expect(runFinder(finder, source, { filePath: "input.html" }).length).toBeGreaterThan(0);
    }
  });

  it("flags UI-noun + directional ('button above', 'section below')", () => {
    const source = `<p>The button above is disabled.</p>`;
    expect(runFinder(finder, source, { filePath: "input.html" }).length).toBeGreaterThan(0);
  });

  it("flags explicit color/shape identification", () => {
    const source = `<p>Click the red button to proceed.</p>`;
    expect(runFinder(finder, source, { filePath: "input.html" }).length).toBeGreaterThan(0);
  });

  it("does NOT flag polysemous nouns preceded by an article ('the view above')", () => {
    // Regression: "Consider the values underlying the view above"
    // matched the directional-verb pattern because "view" is
    // polysemous. With an article before it, it's a noun ("the
    // vista"), not an instruction.
    for (const phrase of [
      "Consider the view above.",
      "a view below the horizon",
      "this view above is striking",
      "my view above the fold",
    ]) {
      const source = `<p>${phrase}</p>`;
      expect(runFinder(finder, source, { filePath: "input.html" })).toEqual([]);
    }
  });

  it("still flags 'view above' when used imperatively", () => {
    // Without an article, "view above" reads as an instruction.
    const source = `<p>To see the summary, view above.</p>`;
    expect(runFinder(finder, source, { filePath: "input.html" }).length).toBeGreaterThan(0);
  });

  it("does not flag benign prose without sensory cues", () => {
    const source = `<p>Welcome to the dashboard. Let's get started.</p>`;
    expect(runFinder(finder, source, { filePath: "input.html" })).toEqual([]);
  });
});
