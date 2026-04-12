import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/layout/text-spacing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule layout/text-spacing", () => {
  describe("fires when", () => {
    it("line-height uses !important", () => {
      const violations = runRule(rule, `.body { line-height: 1.2 !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("layout/text-spacing");
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.message).toContain("line-height");
      expect(violations[0]?.message).toContain("!important");
    });

    it("letter-spacing uses !important", () => {
      const violations = runRule(rule, `p { letter-spacing: 0 !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("letter-spacing");
    });

    it("word-spacing uses !important", () => {
      const violations = runRule(rule, `.text { word-spacing: normal !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("word-spacing");
    });

    it("margin-bottom uses !important", () => {
      const violations = runRule(rule, `p { margin-bottom: 0 !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("margin-bottom");
    });

    it("multiple offending properties in one rule produce multiple violations", () => {
      const violations = runRule(
        rule,
        `.body {
          line-height: 1.2 !important;
          letter-spacing: 0 !important;
          word-spacing: normal !important;
        }`,
        { filePath: "style.css" },
      );
      expect(violations).toHaveLength(3);
    });

    it("flags properties inside @media blocks", () => {
      const violations = runRule(
        rule,
        `@media (max-width: 600px) {
          .content { line-height: 1.1 !important; }
        }`,
        { filePath: "style.css" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("line-height");
    });
  });

  describe("does not fire when", () => {
    it("line-height is set without !important", () => {
      const violations = runRule(rule, `.body { line-height: 1.5; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(0);
    });

    it("an unrelated property uses !important", () => {
      const violations = runRule(
        rule,
        `.box { color: red !important; display: flex !important; }`,
        {
          filePath: "style.css",
        },
      );
      expect(violations).toHaveLength(0);
    });

    it("all four properties are set without !important", () => {
      const violations = runRule(
        rule,
        `.body {
          line-height: 1.5;
          letter-spacing: 0.12em;
          word-spacing: 0.16em;
          margin-bottom: 2em;
        }`,
        { filePath: "style.css" },
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("suggestion recommends removing !important and increasing specificity", () => {
      const violations = runRule(rule, `p { line-height: 1.2 !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("Remove !important");
      expect(violations[0]?.suggestion).toContain("specificity");
    });

    it("message includes the selector for context", () => {
      const violations = runRule(rule, `.article p { letter-spacing: 0 !important; }`, {
        filePath: "style.css",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(".article p");
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.4.12 and wcag21:1.4.12", () => {
      expect(rule.satisfies).toContain("wcag22:1.4.12");
      expect(rule.satisfies).toContain("wcag21:1.4.12");
    });

    it("is document-scoped and severity=warning", () => {
      expect(rule.scope).toBe("document");
      expect(rule.severity).toBe("warning");
    });

    it("has a normativeQuote citing WCAG 1.4.12", () => {
      expect(rule.docs.normativeQuote).toBeDefined();
      expect(rule.docs.normativeQuote).toContain("Line height");
    });
  });
});
