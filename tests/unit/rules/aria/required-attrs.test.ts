import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/required-attrs.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/required-attrs", () => {
  describe("HTML: fires when", () => {
    it("role=checkbox has no aria-checked", () => {
      const violations = runRule(rule, `<div role="checkbox" tabindex="0">Remember me</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/required-attrs");
      expect(violations[0]?.message).toContain("aria-checked");
    });

    it("role=slider has no aria-valuenow", () => {
      const violations = runRule(rule, `<div role="slider" tabindex="0"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("aria-valuenow");
    });

    it("role=switch has no aria-checked", () => {
      const violations = runRule(rule, `<div role="switch" tabindex="0"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("role=separator with tabindex=0 (focusable) requires aria-valuenow", () => {
      const violations = runRule(rule, `<div role="separator" tabindex="0"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("aria-valuenow");
    });
  });

  describe("HTML: does not fire when", () => {
    it("role=checkbox has aria-checked", () => {
      const violations = runRule(
        rule,
        `<div role="checkbox" aria-checked="false" tabindex="0"></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("role=slider has aria-valuenow", () => {
      const violations = runRule(rule, `<div role="slider" aria-valuenow="50"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("element has no role", () => {
      const violations = runRule(rule, `<div></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("role has no required attributes (role=button)", () => {
      const violations = runRule(rule, `<div role="button" tabindex="0">Save</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("role=combobox without aria-expanded is valid in ARIA 1.2", () => {
      const violations = runRule(rule, `<div role="combobox"></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("role=option without aria-selected is valid (context-dependent)", () => {
      const violations = runRule(rule, `<div role="option">Choice A</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("role=separator without tabindex (non-focusable) does not require aria-valuenow", () => {
      const violations = runRule(rule, `<div role="separator"></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("role=checkbox has no aria-checked", () => {
      const violations = runRule(
        rule,
        `const X = <div role="checkbox" tabIndex={0}>Remember me</div>;`,
      );
      expect(violations).toHaveLength(1);
    });

    it("role=separator with tabIndex=0 requires aria-valuenow", () => {
      const violations = runRule(rule, `const X = <div role="separator" tabIndex="0"></div>;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("role=checkbox has aria-checked as expression (runtime-valued)", () => {
      const violations = runRule(
        rule,
        `const X = <div role="checkbox" aria-checked={checked}>x</div>;`,
      );
      expect(violations).toHaveLength(0);
    });

    it("role is an expression (runtime-computed)", () => {
      const violations = runRule(rule, `const X = <div role={dynamic}>x</div>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("role=scrollbar requires aria-valuenow AND aria-controls — both missing produces 2 violations", () => {
      const violations = runRule(rule, `<div role="scrollbar" tabindex="0"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(2);
    });

    it("role=scrollbar with only one of the required attrs still fires on the other", () => {
      const violations = runRule(
        rule,
        `<div role="scrollbar" aria-controls="panel1" tabindex="0"></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("aria-valuenow");
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:4.1.2 and wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });
  });
});
