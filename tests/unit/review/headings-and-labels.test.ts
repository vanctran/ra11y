/**
 * Unit tests for the review/headings-and-labels finder (wcag22:2.4.6).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/headings-and-labels.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/headings-and-labels", () => {
  it("flags an h2 whose text is 'Overview'", () => {
    const source = `const x = <h2>Overview</h2>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("Overview");
    expect(out[0]?.criterionId).toBe("wcag22:2.4.6");
  });

  it("flags an h3 'Details' heading case-insensitively", () => {
    const source = `const x = <h3>details</h3>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags an HTML heading with generic phrase 'Click here'", () => {
    const source = `<h2>Click here</h2>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("Click here");
  });

  it("flags an h4 pagination-style heading 'Page 2'", () => {
    const source = `const x = <h4>Page 2</h4>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a JSX <label> whose text is the generic word 'Field'", () => {
    const source = `const x = <label>Field<input /></label>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("Field");
    expect(out[0]?.reason).toContain("<label>");
  });

  it("flags an HTML <label> placeholder-style 'Enter text'", () => {
    const source = `<label>Enter text<input></label>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag a descriptive h1 'Quarterly revenue'", () => {
    const source = `const x = <h1>Quarterly revenue</h1>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag a descriptive label 'Email address'", () => {
    const source = `const x = <label>Email address<input /></label>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag an empty heading (handled by a separate rule)", () => {
    // An empty <h2> is covered by semantics/empty-heading, not by this
    // descriptiveness finder — don't double-surface.
    const source = `const x = <h2></h2>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag non-heading elements whose text happens to match a generic phrase", () => {
    // 2.4.6 is about headings and labels specifically — a <span> saying
    // "Overview" is not in scope here.
    const source = `const x = <span>Overview</span>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per criterion for each match (WCAG + cross-standards)", () => {
    const source = `const x = <h2>Overview</h2>;`;
    const out = runFinder(finder, source);
    const criteria = new Set(out.map((c) => c.criterionId));
    expect(criteria.has("wcag22:2.4.6")).toBe(true);
    expect(criteria.has("wcag21:2.4.6")).toBe(true);
    expect(criteria.has("section508:2.4.6")).toBe(true);
    expect(criteria.has("en301549:9.2.4.6")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    const source = `const x = <h2>   Overview   </h2>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });
});
