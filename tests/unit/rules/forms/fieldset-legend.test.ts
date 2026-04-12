import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/fieldset-legend.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/fieldset-legend", () => {
  describe("HTML: does not fire when", () => {
    it("legend is present as the first element child with text", () => {
      const violations = runRule(
        rule,
        `<fieldset>
          <legend>Shipping speed</legend>
          <label><input type="radio" name="s" value="std"> Standard</label>
          <label><input type="radio" name="s" value="exp"> Express</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("legend is present but NOT first (defer to HTML validator — name still resolves)", () => {
      const violations = runRule(
        rule,
        `<fieldset>
          <label><input type="radio" name="s" value="std"> Standard</label>
          <legend>Shipping speed</legend>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("fieldset uses aria-label as accessible name", () => {
      const violations = runRule(
        rule,
        `<fieldset aria-label="Shipping speed">
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("fieldset uses aria-labelledby as accessible name", () => {
      const violations = runRule(
        rule,
        `<h2 id="ship-label">Shipping speed</h2>
        <fieldset aria-labelledby="ship-label">
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("HTML: fires when", () => {
    it("fieldset has no legend and no aria-* label", () => {
      const violations = runRule(
        rule,
        `<fieldset>
          <label><input type="radio" name="s" value="std"> Standard</label>
          <label><input type="radio" name="s" value="exp"> Express</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("forms/fieldset-legend");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("no <legend>");
    });

    it("fieldset has an empty <legend>", () => {
      const violations = runRule(
        rule,
        `<fieldset>
          <legend></legend>
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("empty <legend>");
    });

    it("fieldset has a whitespace-only <legend>", () => {
      const violations = runRule(
        rule,
        `<fieldset>
          <legend>   </legend>
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("empty <legend>");
    });

    it("empty aria-label does not rescue a legend-less fieldset", () => {
      const violations = runRule(
        rule,
        `<fieldset aria-label="   ">
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("uses the fieldset's id in the subject for context", () => {
      const violations = runRule(
        rule,
        `<fieldset id="ship">
          <label><input type="radio" name="s" value="std"> Standard</label>
        </fieldset>`,
        { filePath: "form.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`<fieldset id="ship">`);
      expect(violations[0]?.suggestion).toContain(`<fieldset id="ship">`);
    });
  });

  describe("JSX: does not fire when", () => {
    it("legend is present with text content", () => {
      const violations = runRule(
        rule,
        `const X = (
          <fieldset>
            <legend>Shipping speed</legend>
            <label><input type="radio" name="s" value="std" /> Standard</label>
          </fieldset>
        );`,
      );
      expect(violations).toHaveLength(0);
    });

    it("fieldset has aria-label", () => {
      const violations = runRule(
        rule,
        `const X = (
          <fieldset aria-label="Shipping speed">
            <label><input type="radio" name="s" value="std" /> Standard</label>
          </fieldset>
        );`,
      );
      expect(violations).toHaveLength(0);
    });

    it("legend contains a dynamic expression (trusted)", () => {
      const violations = runRule(
        rule,
        `const X = (
          <fieldset>
            <legend>{title}</legend>
            <label><input type="radio" name="s" value="std" /> Standard</label>
          </fieldset>
        );`,
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("fieldset has no legend", () => {
      const violations = runRule(
        rule,
        `const X = (
          <fieldset>
            <label><input type="radio" name="s" value="std" /> Standard</label>
          </fieldset>
        );`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("no <legend>");
    });

    it("fieldset has an empty <legend>", () => {
      const violations = runRule(
        rule,
        `const X = (
          <fieldset>
            <legend></legend>
            <label><input type="radio" name="s" value="std" /> Standard</label>
          </fieldset>
        );`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("empty <legend>");
    });
  });

  describe("rule metadata", () => {
    it("declares all four satisfied criteria", () => {
      expect(rule.satisfies).toContain("wcag22:1.3.1");
      expect(rule.satisfies).toContain("wcag21:1.3.1");
      expect(rule.satisfies).toContain("wcag22:3.3.2");
      expect(rule.satisfies).toContain("wcag21:3.3.2");
    });

    it("is a node-scoped error", () => {
      expect(rule.severity).toBe("error");
      expect(rule.scope).toBe("node");
    });

    it("cites normative WCAG 1.3.1 text", () => {
      expect(rule.docs.normativeQuote).toContain("programmatically determined");
    });
  });
});
