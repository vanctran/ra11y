/**
 * Unit tests for the review/timing finder.
 * Covers wcag22:2.2.1, 2.2.3, 2.2.4, 2.2.5, 2.2.6.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/timing.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/timing", () => {
  it('flags <meta http-equiv="refresh"> in HTML', () => {
    const out = runFinder(finder, `<meta http-equiv="refresh" content="30; url=/next">`, {
      filePath: "a.html",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("refresh");
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.2.1")).toBe(true);
  });

  it("flags setInterval call in TSX source", () => {
    const out = runFinder(finder, `setInterval(() => tick(), 1000);`);
    const hits = out.filter((c) => c.reason.includes("setInterval"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.criterionId).toBe("wcag22:2.2.1");
  });

  it("flags setTimeout call in TSX source", () => {
    const out = runFinder(finder, `setTimeout(() => logout(), 60_000);`);
    const hits = out.filter((c) => c.reason.includes("setTimeout"));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("does not flag mere references to the identifiers (no paren)", () => {
    const out = runFinder(finder, `const fn = setTimeout;`);
    // `setTimeout;` with no paren should NOT match because regex requires `\s*\(`
    const hits = out.filter((c) => c.reason.includes("setTimeout"));
    expect(hits).toHaveLength(0);
  });

  it('flags <meta httpEquiv="refresh"> in JSX', () => {
    const out = runFinder(finder, `const X = <meta httpEquiv="refresh" content="60" />;`);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag <meta charset> etc.", () => {
    const out = runFinder(finder, `<meta charset="utf-8">`, { filePath: "a.html" });
    expect(out).toEqual([]);
  });

  it("every hit carries both wcag22 and wcag21 equivalents", () => {
    const out = runFinder(finder, `setInterval(() => tick(), 1000);`);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.2.1")).toBe(true);
    expect(ids.has("wcag21:2.2.1")).toBe(true);
  });

  it("one setTimeout + one setInterval → two distinct candidate offsets", () => {
    const out = runFinder(finder, `setInterval(() => a(), 100); setTimeout(() => b(), 200);`);
    const offsets = new Set(out.map((c) => `${c.location.line}:${c.location.column}`));
    expect(offsets.size).toBeGreaterThanOrEqual(2);
  });
});
