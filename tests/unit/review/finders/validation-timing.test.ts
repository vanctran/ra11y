/**
 * Unit tests for the review/validation-timing finder
 * (wcag22:3.3.3 Error Suggestion, wcag22:3.3.4 Error Prevention).
 *
 * The finder surfaces JSX onChange handlers whose body or referenced
 * identifier looks validation-shaped. These tests pin the two detection
 * paths (inline body token, bare-reference identifier cue) and confirm
 * the criterion mapping covers both WCAG versions.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../../src/review/finders/validation-timing.ts";
import { runFinder } from "../../../helpers/run-finder.ts";

describe("review/validation-timing", () => {
  // ----- positive cases ---------------------------------------------------

  it("flags inline onChange that calls setErrors in body", () => {
    const source = `const x = <input onChange={(e) => { setErrors({ email: "bad" }); }} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBe(4);
    const first = out[0];
    expect(first?.reason).toContain("setError(s) call");
    expect(first?.reason).toContain("onBlur");
    expect(first?.confidence).toBe("medium");
  });

  it("flags bare identifier reference whose name matches /validate/", () => {
    const source = `const x = <input onChange={validateEmail} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBe(4);
    expect(out[0]?.reason).toContain("validateEmail");
    expect(out[0]?.reason).toContain("validation-shaped name");
    expect(out[0]?.reason).toContain("onBlur");
  });

  it("flags inline onChange that calls schema.parse", () => {
    const source = `const x = <input onChange={(e) => schema.parse(e.target.value)} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("schema.parse/safeParse call");
  });

  it("flags named *Schema identifier calling safeParse", () => {
    const source = `const x = <input onChange={(e) => { emailSchema.safeParse(e.target.value); }} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("schema.parse/safeParse call");
  });

  it("flags dotted reference whose tail matches the validation-name cue", () => {
    const source = `const x = <input onChange={this.validateEmail} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("this.validateEmail");
  });

  it("emits one candidate per matching criterion (2 wcag22 + 2 wcag21)", () => {
    const source = `const x = <input onChange={(e) => setErrors({})} />;`;
    const out = runFinder(finder, source);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:3.3.3")).toBe(true);
    expect(ids.has("wcag22:3.3.4")).toBe(true);
    expect(ids.has("wcag21:3.3.3")).toBe(true);
    expect(ids.has("wcag21:3.3.4")).toBe(true);
  });

  // ----- negative cases ---------------------------------------------------

  it("does not fire on onChange that only calls a controlled-input setter", () => {
    const source = `const x = <input onChange={(e) => setValue(e.target.value)} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not fire on bare setValue reference (not a validation-named ident)", () => {
    const source = `const x = <input onChange={setValue} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not fire when the element has no onChange handler at all", () => {
    const source = `const x = <input onBlur={validateEmail} />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not fire on a non-form JSX element with no onChange", () => {
    const source = `const x = <div onClick={handleClick}>body</div>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not fire on HTML files — finder is JSX-only", () => {
    const source = `<input onchange="validateEmail(this.value)">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  // ----- edge cases -------------------------------------------------------

  it("fires on onChange over a non-form element (agent decides if onChange is meaningful)", () => {
    // Per AI-first doctrine we surface the candidate regardless of tag;
    // the agent reads the file and confirms whether the element is a
    // controlled form control wrapper or something unrelated.
    const source = `const x = <MyField onChange={validateEmail} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBe(4);
    expect(out[0]?.reason).toContain("<MyField>");
  });

  it("truncates very long reference snippets in the reason text", () => {
    const long = "aRidiculouslyLongValidateIdentifierThatExceedsTheSnippetCapWeSetAbove";
    const source = `const x = <input onChange={${long}} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("…");
  });

  it("flags inline onChange that throws on invalid input", () => {
    const source = `const x = <input onChange={(e) => { if (!ok(e)) throw new Error("bad"); }} />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("throw new ...");
  });
});
