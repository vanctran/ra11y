import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/focus/tabindex-positive.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule focus/tabindex-positive", () => {
  describe("HTML: fires when", () => {
    it("tabindex is a positive integer", () => {
      const violations = runRule(rule, `<a href="/" tabindex="5">Fifth</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("focus/tabindex-positive");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("parsed as 5");
      expect(violations[0]?.suggestion).toContain('tabindex="0"');
    });

    it("tabindex has leading/trailing whitespace around a positive integer", () => {
      const violations = runRule(rule, `<button tabindex="  3  ">Three</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("parsed as 3");
    });

    it("tabindex is a zero-padded positive integer (01 -> 1)", () => {
      const violations = runRule(rule, `<div tabindex="01">Padded</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("parsed as 1");
    });

    it("multiple elements each contribute a violation", () => {
      const html = `
        <a href="/" tabindex="1">a</a>
        <button tabindex="2">b</button>
        <span tabindex="0">ok</span>
        <div tabindex="7">d</div>
      `;
      const violations = runRule(rule, html, { filePath: "index.html" });
      expect(violations).toHaveLength(3);
    });
  });

  describe("HTML: does not fire when", () => {
    it("tabindex is 0", () => {
      const violations = runRule(rule, `<div tabindex="0">Focusable</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("tabindex is -1", () => {
      const violations = runRule(rule, `<div tabindex="-1">Programmatic</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("element has no tabindex at all", () => {
      const violations = runRule(rule, `<button>Hello</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("tabindex value is non-numeric garbage", () => {
      const violations = runRule(rule, `<div tabindex="abc">garbage</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("tabIndex is a string-literal positive integer", () => {
      const violations = runRule(rule, `const X = <a href="/" tabIndex="5">Fifth</a>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
    });

    it("tabIndex is a numeric-literal expression {2}", () => {
      const violations = runRule(rule, `const X = <button tabIndex={2}>Two</button>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("parsed as 2");
    });

    it("tabIndex expression has interior whitespace {  4  }", () => {
      const violations = runRule(rule, `const X = <div tabIndex={  4  }>Four</div>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("parsed as 4");
    });

    it("multiple offending JSX elements", () => {
      const source = `
        const A = <a tabIndex={1}>a</a>;
        const B = <b tabIndex="2">b</b>;
        const C = <c tabIndex={0}>c</c>;
      `;
      const violations = runRule(rule, source);
      expect(violations).toHaveLength(2);
    });
  });

  describe("JSX: does not fire when", () => {
    it("tabIndex is {0}", () => {
      const violations = runRule(rule, `const X = <div tabIndex={0}>ok</div>;`);
      expect(violations).toHaveLength(0);
    });

    it("tabIndex is {-1}", () => {
      const violations = runRule(rule, `const X = <div tabIndex={-1}>ok</div>;`);
      expect(violations).toHaveLength(0);
    });

    it("tabIndex is a variable expression {someVar}", () => {
      // Static analysis cannot know the runtime value; we deliberately
      // skip to avoid flooding devs with false positives.
      const violations = runRule(rule, `const X = <div tabIndex={someVar}>?</div>;`);
      expect(violations).toHaveLength(0);
    });

    it("tabIndex is a function call expression {getIndex()}", () => {
      const violations = runRule(rule, `const X = <div tabIndex={getIndex()}>?</div>;`);
      expect(violations).toHaveLength(0);
    });

    it("element has no tabIndex attribute at all", () => {
      const violations = runRule(rule, `const X = <button>Hi</button>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:2.4.3 and wcag21:2.4.3", () => {
      expect(rule.satisfies).toContain("wcag22:2.4.3");
      expect(rule.satisfies).toContain("wcag21:2.4.3");
    });

    it("is document-scoped (afterFile)", () => {
      expect(rule.scope).toBe("document");
      expect(typeof rule.afterFile).toBe("function");
    });

    it("has error severity", () => {
      expect(rule.severity).toBe("error");
    });
  });
});
