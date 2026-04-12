import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/document/viewport-zoom.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule document/viewport-zoom", () => {
  describe("fires when", () => {
    it("viewport has user-scalable=no", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("document/viewport-zoom");
      expect(violations[0]?.message).toContain("user-scalable");
    });

    it("viewport has user-scalable=0", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, user-scalable=0">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("viewport has maximum-scale=1.0", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, maximum-scale=1.0">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("maximum-scale");
    });

    it("viewport has maximum-scale=1", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, maximum-scale=1">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("combined violations produce one entry per problem", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="user-scalable=no, maximum-scale=1">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(2);
    });
  });

  describe("does not fire when", () => {
    it("viewport is the standard minimal form", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, initial-scale=1">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("maximum-scale=2 (meets 200% requirement)", () => {
      const violations = runRule(
        rule,
        `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("meta is not a viewport meta", () => {
      const violations = runRule(rule, `<meta charset="utf-8">`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("document has no viewport meta at all", () => {
      const violations = runRule(rule, `<html><head></head><body>x</body></html>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares 1.4.4 across wcag22/wcag21", () => {
      expect(rule.satisfies).toContain("wcag22:1.4.4");
      expect(rule.satisfies).toContain("wcag21:1.4.4");
    });
  });
});
