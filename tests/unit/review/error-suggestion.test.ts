/**
 * Unit tests for the review/error-suggestion finder (wcag22:3.3.3).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/error-suggestion.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/error-suggestion", () => {
  it("flags HTML required input with bare aria-describedby error text", () => {
    const source = `
      <label for="email">Email</label>
      <input id="email" required aria-describedby="email-error">
      <p id="email-error">This field is required</p>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBe(4);
    expect(out[0]?.reason).toContain("aria-describedby");
  });

  it('flags HTML email input with adjacent role="alert" text', () => {
    const source = `
      <div>
        <input type="email" name="email">
        <div role="alert">Invalid email</div>
      </div>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain('role="alert"');
  });

  it("flags JSX pattern input with adjacent error-class text", () => {
    const source = `
      const x = (
        <div>
          <input pattern="[0-9]{5}" />
          <p className="field-error">Invalid</p>
        </div>
      );
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("error-class");
  });

  it("does not flag when the described message offers a correction", () => {
    const source = `
      <input type="email" aria-describedby="email-error">
      <p id="email-error">Enter an email address in the format name@example.com</p>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag when the input has no relevant validation trigger", () => {
    const source = `
      <input aria-describedby="name-error">
      <p id="name-error">Required field</p>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag non-error alert text", () => {
    const source = `
      <div>
        <input type="tel">
        <div role="alert">Looks good</div>
      </div>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag PascalCase component wrappers", () => {
    const source = `
      const x = (
        <div>
          <Input required aria-describedby="name-error" />
          <p id="name-error">Required field</p>
        </div>
      );
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching cross-standard criterion id", () => {
    const source = `
      <input required aria-describedby="name-error">
      <p id="name-error">Required field</p>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    const ids = new Set(out.map((candidate) => candidate.criterionId));
    expect(ids.has("wcag22:3.3.3")).toBe(true);
    expect(ids.has("wcag21:3.3.3")).toBe(true);
    expect(ids.has("section508:3.3.3")).toBe(true);
    expect(ids.has("en301549:9.3.3.3")).toBe(true);
    expect(out.length).toBe(4);
  });
});
