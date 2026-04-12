import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/autocomplete-missing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/autocomplete-missing", () => {
  describe("HTML: fires when", () => {
    it("type=email has no autocomplete", () => {
      const violations = runRule(rule, `<input type="email" name="email">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("forms/autocomplete-missing");
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.suggestion).toContain(`autocomplete="email"`);
    });

    it("type=tel has no autocomplete", () => {
      const violations = runRule(rule, `<input type="tel" name="phone">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain(`autocomplete="tel"`);
    });

    it("type=password has no autocomplete", () => {
      const violations = runRule(rule, `<input type="password" name="pw">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain(`current-password`);
    });

    it("type=text with name='firstName' infers given-name", () => {
      const violations = runRule(rule, `<input type="text" name="firstName">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("given-name");
    });

    it("type=text with id='zipCode' infers postal-code", () => {
      const violations = runRule(rule, `<input type="text" id="zipCode">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("postal-code");
    });
  });

  describe("HTML: does not fire when", () => {
    it("input has autocomplete", () => {
      const violations = runRule(rule, `<input type="email" autocomplete="email">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("type=checkbox", () => {
      const violations = runRule(rule, `<input type="checkbox" name="agree">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("type=submit", () => {
      const violations = runRule(rule, `<input type="submit" value="Save">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("type=text with unrecognized name", () => {
      const violations = runRule(rule, `<input type="text" name="searchQuery">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("type=hidden", () => {
      const violations = runRule(rule, `<input type="hidden" name="csrfToken">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("type=email has no autoComplete", () => {
      const violations = runRule(rule, `const X = <input type="email" name="email" />;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("input has autoComplete (React prop name)", () => {
      const violations = runRule(rule, `const X = <input type="email" autoComplete="email" />;`);
      expect(violations).toHaveLength(0);
    });

    it("input has autocomplete (HTML attribute name, also allowed)", () => {
      const violations = runRule(rule, `const X = <input type="email" autocomplete="email" />;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.3.5 and wcag21:1.3.5", () => {
      expect(rule.satisfies).toContain("wcag22:1.3.5");
      expect(rule.satisfies).toContain("wcag21:1.3.5");
    });
  });
});
