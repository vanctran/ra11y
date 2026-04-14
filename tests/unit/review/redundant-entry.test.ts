/**
 * Unit tests for the review/redundant-entry finder (wcag22:3.3.7).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/redundant-entry.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/redundant-entry", () => {
  it("flags duplicate autocomplete purposes inside one HTML form", () => {
    const source = `
      <form>
        <label for="email">Email</label>
        <input id="email" autocomplete="email">
        <label for="confirm-email">Confirm email</label>
        <input id="confirm-email" autocomplete="email">
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBe(1);
    expect(out[0]?.criterionId).toBe("wcag22:3.3.7");
    expect(out[0]?.reason).toContain('autocomplete="email"');
  });

  it("flags repeated type=email inputs inside one JSX form", () => {
    const source = `
      const page = (
        <form>
          <input type="email" />
          <input type="email" />
        </form>
      );
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain('type="email"');
  });

  it("flags repeated associated label text when the label suggests personal data", () => {
    const source = `
      <form>
        <label for="primary">Email address</label>
        <input id="primary">
        <label for="backup">Email address</label>
        <input id="backup">
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain('label text "email address"');
  });

  it("flags duplicate personal-data names inside one HTML form", () => {
    const source = `
      <form>
        <input name="billing_email">
        <input name="billing_email">
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain('name="billing_email"');
  });

  it("does not flag matching purposes across separate forms", () => {
    const source = `
      <form>
        <input autocomplete="email">
      </form>
      <form>
        <input autocomplete="email">
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag same-name radio groups", () => {
    const source = `
      <form>
        <label><input type="radio" name="contact_method"> Email</label>
        <label><input type="radio" name="contact_method"> Phone</label>
      </form>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });
});
