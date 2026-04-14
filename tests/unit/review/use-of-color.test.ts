/**
 * Unit tests for the review/use-of-color finder (wcag22:1.4.1).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/use-of-color.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/use-of-color", () => {
  it("flags a JSX element with a status-color class and no other signal", () => {
    const source = `const x = <span className="text-red-600" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("text-red-600");
  });

  it("flags bg-danger on a status badge with no text child", () => {
    const source = `const x = <div className="bg-danger-500" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags an HTML element with class attribute", () => {
    const source = `<span class="text-red-500"></span>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag when aria-label is present", () => {
    const source = `const x = <span className="text-red-600" aria-label="Error" />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when a status word appears in the text", () => {
    const source = `const x = <span className="text-red-600">Error</span>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when an Icon sibling is present", () => {
    const source = `const x = <span className="text-red-600"><AlertIcon /></span>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag non-status colors (blue/indigo/primary)", () => {
    const source = `const x = <span className="text-blue-500" />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when an <svg> child is present in HTML", () => {
    const source = `<span class="text-red-500"><svg></svg></span>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag a shape-signal glyph (required asterisk idiom)", () => {
    // `*` conveys "required" by shape/convention alone — it's a G182
    // additional visual cue, so a sighted colorblind user reading the
    // form gets the signal independent of color.
    const source = `const x = <span className="text-error">*</span>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag shape-signal glyphs (✓ / ✗ / ⚠ / →)", () => {
    for (const glyph of ["✓", "✗", "⚠", "→"]) {
      const source = `const x = <span className="text-red-600">${glyph}</span>;`;
      expect(runFinder(finder, source)).toEqual([]);
    }
  });

  it("still flags a geometric-only shape that carries no meaning by shape", () => {
    // Counterexample from the Codex review of the reverted aria-hidden
    // commit: a red dot paired with sr-only text. The dot isn't a
    // shape signal — a colorblind user sees a gray mark and learns
    // nothing from the shape alone. Must stay flagged (WCAG F81).
    const source = `const x = <span className="text-red-500">●</span>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("emits one candidate per matching criterion id", () => {
    const source = `const x = <span className="text-red-600" />;`;
    const out = runFinder(finder, source);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:1.4.1")).toBe(true);
    expect(ids.has("wcag21:1.4.1")).toBe(true);
  });
});
