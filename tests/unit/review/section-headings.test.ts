/**
 * Unit tests for the review/section-headings finder (wcag22:2.4.10).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/section-headings.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/section-headings", () => {
  it("flags an HTML section with content but no heading or label", () => {
    const source = `<section><p>Billing details</p></section>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("no descendant heading");
  });

  it("flags a JSX section with nested content but no heading", () => {
    const source = `
      const page = (
        <section>
          <div>
            <p>Account summary</p>
          </div>
        </section>
      );
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a self-closing JSX section", () => {
    const source = `const page = <section />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag an HTML section with a direct heading child", () => {
    const source = `<section><h2>Billing details</h2><p>...</p></section>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag a JSX section with a nested heading descendant", () => {
    const source = `
      const page = (
        <section>
          <header>
            <h3>Account summary</h3>
          </header>
          <p>Details</p>
        </section>
      );
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag a section with aria-label", () => {
    const source = `<section aria-label="Billing details"><p>...</p></section>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag a JSX section with aria-labelledby", () => {
    const source = `
      const page = (
        <section aria-labelledby="summary-title">
          <div>Account summary</div>
        </section>
      );
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching criterion id", () => {
    const source = `<section><p>Billing details</p></section>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.4.10")).toBe(true);
    expect(ids.has("wcag21:2.4.10")).toBe(true);
  });
});
