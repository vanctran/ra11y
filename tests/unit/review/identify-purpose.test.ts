/**
 * Unit tests for the review/identify-purpose finder (wcag22:1.3.6).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/identify-purpose.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/identify-purpose", () => {
  it('flags HTML <input type="email"> without autocomplete', () => {
    const out = runFinder(finder, `<input type="email" name="contact">`, {
      filePath: "a.html",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.criterionId).toBe("wcag22:1.3.6");
  });

  it('does not flag HTML <input type="email"> WITH autocomplete', () => {
    const out = runFinder(finder, `<input type="email" autocomplete="email">`, {
      filePath: "a.html",
    });
    expect(out).toEqual([]);
  });

  it("does not flag non-purposable types (checkbox, submit, button)", () => {
    const out = runFinder(
      finder,
      `<input type="checkbox"><input type="submit"><input type="button">`,
      { filePath: "a.html" },
    );
    expect(out).toEqual([]);
  });

  it("flags <textarea> without autocomplete", () => {
    const out = runFinder(finder, `<textarea name="message"></textarea>`, {
      filePath: "a.html",
    });
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags <select> without autocomplete", () => {
    const out = runFinder(finder, `<select name="country"></select>`, {
      filePath: "a.html",
    });
    expect(out.length).toBeGreaterThan(0);
  });

  it('JSX: flags <input type="tel"> without autoComplete prop', () => {
    const out = runFinder(finder, `const X = <input type="tel" name="phone" />;`);
    expect(out.length).toBeGreaterThan(0);
  });

  it('JSX: does not flag <input autoComplete="tel">', () => {
    const out = runFinder(finder, `const X = <input type="tel" autoComplete="tel" />;`);
    expect(out).toEqual([]);
  });

  it('JSX: does not flag <input autocomplete="tel"> (lowercase also accepted)', () => {
    const out = runFinder(finder, `const X = <input type="tel" autocomplete="tel" />;`);
    expect(out).toEqual([]);
  });

  it("HTML default <input> type is text — flagged without autocomplete", () => {
    const out = runFinder(finder, `<input name="firstname">`, { filePath: "a.html" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("emits wcag22:1.3.6 and wcag21:1.3.6", () => {
    const out = runFinder(finder, `<input type="email">`, { filePath: "a.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:1.3.6")).toBe(true);
    expect(ids.has("wcag21:1.3.6")).toBe(true);
  });
});
