/**
 * Unit tests for the review/server-error-untied finder (wcag22:3.3.1).
 *
 * The finder asks: is a live-region / alert node sitting beside a native
 * form control whose wiring does not make the pairing obvious? Tests
 * exercise both HTML and JSX surfaces, positive (alert + untied control),
 * negative (wired correctly, unrelated DOM shapes), and edge cases
 * (aria-live="off", describedby token mismatch, expression aria-invalid).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../../src/review/finders/server-error-untied.ts";
import { runFinder } from "../../../helpers/run-finder.ts";

describe("review/server-error-untied", () => {
  // ---------- positive: finder fires ----------

  it('flags a <p role="alert"> sibling of an <input> that has no aria-invalid', () => {
    const source = `
      <form>
        <label for="email">Email</label>
        <input id="email" name="email">
        <p role="alert" id="email-error">Email is required</p>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.criterionId).toBe("wcag22:3.3.1");
    expect(out[0]?.reason).toContain('role="alert"');
    expect(out[0]?.reason).toContain("aria-invalid");
  });

  it('flags a <div aria-live="polite"> sibling of a <textarea> with no wiring', () => {
    const source = `
      <form>
        <textarea name="bio"></textarea>
        <div aria-live="polite" id="bio-error">Too long</div>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain('aria-live="polite"');
  });

  it('flags JSX <p role="alert"> sibling of <select> with no wiring', () => {
    const source = `
      const form = (
        <form>
          <select name="country" />
          <p role="alert" id="country-error">Country required</p>
        </form>
      );
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.confidence).toBe("medium");
  });

  it('flags JSX aria-live="assertive" sibling of an untied input', () => {
    const source = `
      const form = (
        <form>
          <input name="email" />
          <div aria-live="assertive">Server said no</div>
        </form>
      );
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("no id");
  });

  it("fires when aria-describedby on the control points at a DIFFERENT id than the alert's", () => {
    const source = `
      <form>
        <input aria-invalid="true" aria-describedby="helptext">
        <p role="alert" id="email-error">Server error</p>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    // aria-invalid is present but describedby does not tokenize to
    // "email-error" — the alert is still untied.
    expect(out.length).toBeGreaterThan(0);
  });

  // ---------- negative: finder does NOT fire ----------

  it("does not flag when the control has aria-invalid and aria-describedby pointing at the alert's id", () => {
    const source = `
      <form>
        <input aria-invalid="true" aria-describedby="email-error" name="email">
        <p role="alert" id="email-error">Email is required</p>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out).toEqual([]);
  });

  it("does not flag when aria-describedby is a space-separated list containing the id", () => {
    const source = `
      <form>
        <input aria-invalid="true" aria-describedby="helptext  email-error" name="email">
        <p role="alert" id="email-error">Email is required</p>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out).toEqual([]);
  });

  it('does not flag when aria-live="off" (suppression, not an error surface)', () => {
    const source = `
      <form>
        <input name="email">
        <div aria-live="off">inactive region</div>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out).toEqual([]);
  });

  it("does not flag when no native form control sibling is present", () => {
    const source = `
      <div>
        <p role="alert" id="page-toast">Server down</p>
        <button>Retry</button>
      </div>
    `;
    const out = runFinder(finder, source, { filePath: "page.html" });
    expect(out).toEqual([]);
  });

  it("does not flag JSX with PascalCase wrapper components (attribute forwarding invisible)", () => {
    const source = `
      const form = (
        <form>
          <Input name="email" />
          <p role="alert" id="email-error">Required</p>
        </form>
      );
    `;
    const out = runFinder(finder, source);
    // <Input> isn't a native form control; the finder skips it.
    expect(out).toEqual([]);
  });

  it("does not flag JSX when aria-describedby is a literal string containing the alert's id", () => {
    const source = `
      const form = (
        <form>
          <input aria-invalid={true} aria-describedby="email-error" />
          <p role="alert" id="email-error">Required</p>
        </form>
      );
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  // ---------- edge cases ----------

  it("fires once per alert even when multiple sibling controls are untied", () => {
    const source = `
      <form>
        <input name="first">
        <input name="second">
        <p role="alert" id="err">Error</p>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "form.html" });
    // One candidate per alert, not per control — the candidate points at
    // the alert's line:column.
    expect(out.length).toBe(1);
  });

  it("uses the alert's location (not the control's) for the candidate line", () => {
    const source = [
      "<form>",
      '  <input name="email">',
      '  <p role="alert" id="err">Required</p>',
      "</form>",
    ].join("\n");
    const out = runFinder(finder, source, { filePath: "form.html" });
    expect(out.length).toBe(1);
    // The <p> sits on line 3 (1-indexed).
    expect(out[0]?.location.line).toBe(3);
  });

  it("treats aria-invalid with expression value on JSX as 'present' (loose heuristic)", () => {
    // The finder requires `aria-invalid` to be PRESENT on the control
    // (value-agnostic) because the invalid state is typically a boolean
    // expression. A control with `aria-invalid={hasError}` and a
    // describedby pointing at the alert id is considered wired.
    const source = `
      const form = (
        <form>
          <input aria-invalid={hasError} aria-describedby="err" />
          <p role="alert" id="err">Required</p>
        </form>
      );
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag a nested live-region that only sits with non-control siblings", () => {
    const source = `
      <section>
        <h2>Form errors</h2>
        <div aria-live="polite">No errors yet</div>
        <p>Below are the form fields.</p>
      </section>
    `;
    const out = runFinder(finder, source, { filePath: "page.html" });
    expect(out).toEqual([]);
  });
});
