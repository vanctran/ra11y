/**
 * Unit tests for the review/error-identification finder (wcag22:3.3.1).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/error-identification.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/error-identification", () => {
  it('flags HTML <input aria-invalid="true"> with no association', () => {
    const source = `<input aria-invalid="true" name="email">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("aria-invalid");
  });

  it("flags <select> and <textarea> the same way", () => {
    const selectOut = runFinder(finder, `<select aria-invalid="true"></select>`, {
      filePath: "input.html",
    });
    const textareaOut = runFinder(finder, `<textarea aria-invalid="true"></textarea>`, {
      filePath: "input.html",
    });
    expect(selectOut.length).toBeGreaterThan(0);
    expect(textareaOut.length).toBeGreaterThan(0);
  });

  it('flags JSX <input aria-invalid="true" /> with no association', () => {
    const source = `const x = <input aria-invalid="true" name="email" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags JSX <input aria-invalid={true} /> with no association", () => {
    const source = `const x = <input aria-invalid={true} name="email" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it('flags JSX <input aria-invalid={"true"} /> — quoted string in expression', () => {
    const source = `const x = <input aria-invalid={"true"} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags JSX <input aria-invalid={'true'} /> — single-quoted string in expression", () => {
    const source = `const x = <input aria-invalid={'true'} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it('does not flag input type={"hidden"} with aria-invalid set', () => {
    const source = `const x = <input type={"hidden"} aria-invalid={true} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when aria-describedby is present", () => {
    const source = `<input aria-invalid="true" aria-describedby="err1">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag when aria-errormessage is present", () => {
    const source = `<input aria-invalid="true" aria-errormessage="err1">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag JSX with aria-describedby wired", () => {
    const source = `const x = <input aria-invalid={true} aria-describedby="err" />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when aria-invalid is false", () => {
    const source = `<input aria-invalid="false">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag when aria-invalid is absent", () => {
    const source = `<input name="email">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag PascalCase component wrappers", () => {
    const source = `const x = <Input aria-invalid={true} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag variable expressions in aria-invalid (non-literal)", () => {
    const source = `const x = <input aria-invalid={hasError} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag input[type=hidden]", () => {
    const source = `<input type="hidden" aria-invalid="true">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching criterion id", () => {
    const source = `<input aria-invalid="true">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:3.3.1")).toBe(true);
    expect(ids.has("wcag21:3.3.1")).toBe(true);
  });

  it("does not flag aria-invalid without a value on the shorthand form (conservative)", () => {
    // Conservative: shorthand `aria-invalid` without `=true` is ambiguous.
    // Several browsers treat it as true; others as false. Until the spec
    // and browser behavior converge, we don't emit a candidate.
    const source = `<input aria-invalid>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });
});
