import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/valid-attr.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/valid-attr", () => {
  describe("HTML: fires a violation when", () => {
    it("attribute is a typo of a real aria attribute", () => {
      const violations = runRule(rule, `<div role="button" aria-preessed="false">Toggle</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/valid-attr");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.criteria).toContain("wcag22:4.1.2");
    });

    it("suggestion names the nearest valid attribute for typos", () => {
      const violations = runRule(rule, `<div aria-lable="hi"></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("aria-label");
    });

    it("attribute is completely invented (no close match)", () => {
      const violations = runRule(rule, `<div aria-foo="bar"></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      // No nearest-within-2 match for aria-foo — the suggestion should
      // tell the author to remove or replace it.
      expect(violations[0]?.suggestion?.toLowerCase()).toContain("remove");
    });

    it("element has multiple aria attributes and one is invalid", () => {
      const src = `<div aria-label="ok" aria-pressed="false" aria-preessed="true">x</div>`;
      const violations = runRule(rule, src, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("aria-preessed");
    });

    it("multi-attribute element with two invalid attributes fires twice", () => {
      const src = `<div aria-lable="a" aria-hiden="true">x</div>`;
      const violations = runRule(rule, src, { filePath: "index.html" });
      expect(violations).toHaveLength(2);
    });
  });

  describe("HTML: does not fire when", () => {
    it("attribute is a valid aria-* state", () => {
      const violations = runRule(rule, `<div role="button" aria-pressed="false">x</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("attribute is uppercase (case-insensitive match)", () => {
      const violations = runRule(rule, `<div ARIA-LABEL="ok">x</div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("element has no aria-* attributes at all", () => {
      const violations = runRule(rule, `<div class="x" id="y">hello</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("element uses aria-brailleroledescription (the longest valid attr)", () => {
      const violations = runRule(rule, `<div aria-brailleroledescription="kbd">x</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("element uses all aria-col* table attributes together", () => {
      const src = `<div role="cell" aria-colcount="3" aria-colindex="1" aria-colindextext="A" aria-colspan="2">x</div>`;
      const violations = runRule(rule, src, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("element uses aria-describedby, aria-details, aria-labelledby together", () => {
      const src = `<input aria-describedby="d" aria-details="x" aria-labelledby="l">`;
      const violations = runRule(rule, src, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires a violation when", () => {
    it("attribute is a typo", () => {
      const violations = runRule(
        rule,
        `const X = <div role="button" aria-preessed="false">Toggle</div>;`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/valid-attr");
      expect(violations[0]?.message).toContain("aria-preessed");
    });

    it("multiple offending elements produce multiple violations", () => {
      const src = `const X = <div><span aria-lable="a" /><span aria-hiden="true" /></div>;`;
      const violations = runRule(rule, src);
      expect(violations).toHaveLength(2);
    });
  });

  describe("JSX: does not fire when", () => {
    it("attribute is valid", () => {
      const violations = runRule(
        rule,
        `const X = <div role="button" aria-pressed="false">Save</div>;`,
      );
      expect(violations).toHaveLength(0);
    });

    it("aria attribute value is a runtime expression (name still valid)", () => {
      const violations = runRule(rule, `const X = <div aria-label={dynamic}>x</div>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("data-* attributes are ignored (not aria-*)", () => {
      const violations = runRule(rule, `<div data-foo="bar" data-aria-fake="x">x</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("an attribute literally named 'aria-' is flagged as unknown", () => {
      // Malformed but parseable; not a real aria attribute.
      const violations = runRule(rule, `<div aria-="oops">x</div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
    });

    it("element with role but no aria attributes is fine", () => {
      const violations = runRule(rule, `<div role="button">x</div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:4.1.2 and wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });

    it("has a normativeQuote citing WCAG", () => {
      expect(rule.docs.normativeQuote).toBeDefined();
      expect(rule.docs.normativeQuote.length).toBeGreaterThan(0);
      expect(rule.docs.references[0]).toContain("WCAG22");
    });

    it("references the WAI-ARIA state/property dictionary", () => {
      expect(rule.docs.references.some((r) => r.includes("wai-aria-1.2"))).toBe(true);
    });
  });
});
