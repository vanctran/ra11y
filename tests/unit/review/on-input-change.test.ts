/**
 * Unit tests for the review/on-input-change finder
 * (wcag22:3.2.1 On Focus, wcag22:3.2.2 On Input).
 *
 * The finder surfaces every focus/blur/change handler and tiers the
 * candidate by confidence. These tests pin both tiers and the mapping
 * between attribute name and emitted criterion.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/on-input-change.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/on-input-change", () => {
  it("high-confidence: flags onChange that calls router.push in-body", () => {
    const source = `const x = <input onChange={() => router.push("/x")} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    const first = out[0];
    expect(first?.reason).toContain("router navigation");
    expect(first?.reason).toContain("high confidence");
    expect(first?.criterionId).toBe("wcag22:3.2.2");
  });

  it("high-confidence: flags onFocus that calls window.location.href", () => {
    const source = `const x = <input onFocus={() => { window.location.href = "/x"; }} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("window.location change");
    expect(out[0]?.reason).toContain("high confidence");
    expect(out[0]?.criterionId).toBe("wcag22:3.2.1");
  });

  it("high-confidence: flags HTML onchange with .submit()", () => {
    const source = `<input onchange="this.form.submit()">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain(".submit() call");
    expect(out[0]?.reason).toContain("high confidence");
  });

  it("low-confidence (reference): flags onChange={handleChange} and names the identifier", () => {
    const source = `const x = <input onChange={handleChange} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    const first = out[0];
    expect(first?.reason).toContain("low confidence");
    expect(first?.reason).toContain("handleChange");
    expect(first?.reason).toContain("handler body not inline");
  });

  it("low-confidence (inline body, no nav pattern): flags a visible-but-clean onChange", () => {
    const source = `const x = <input onChange={() => setValue(e.target.value)} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("low confidence");
    expect(out[0]?.reason).toContain("inline body visible");
  });

  it("low-confidence (dotted reference): flags onChange={this.handleChange}", () => {
    const source = `const x = <input onChange={this.handleChange} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("low confidence");
    expect(out[0]?.reason).toContain("this.handleChange");
  });

  it("emits separate candidates per matching handler attribute on the same element", () => {
    // <input> with both onChange and onBlur — 2 handlers, each mapped
    // to its own criterion pair, so 4 candidates total (2 handlers × 2
    // WCAG versions), none dropped.
    const source = `const x = <input onChange={handleChange} onBlur={handleBlur} />;`;
    const out = runFinder(finder, source);
    // 2 handlers × 2 criterion IDs each = 4 candidates.
    expect(out.length).toBe(4);
    const criteria = new Set(out.map((c) => c.criterionId));
    expect(criteria.has("wcag22:3.2.1")).toBe(true);
    expect(criteria.has("wcag22:3.2.2")).toBe(true);
    expect(criteria.has("wcag21:3.2.1")).toBe(true);
    expect(criteria.has("wcag21:3.2.2")).toBe(true);
  });

  it("does not fire on elements without a focus/blur/change handler", () => {
    const source = `const x = <input onClick={handleClick} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("truncates very long reference expressions in the reason snippet", () => {
    const long = "someRidiculouslyLongHandlerNameUsedToExceedTheSnippetCapInReasonText.bind(this)";
    const source = `const x = <input onChange={${long}} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("…");
  });

  it("HTML: low-confidence when the handler body has no nav signal", () => {
    const source = `<input onfocus="this.dataset.touched = '1'">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("low confidence");
  });
});
