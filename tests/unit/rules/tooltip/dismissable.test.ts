import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/tooltip/dismissable.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule tooltip/dismissable", () => {
  describe("HTML: fires a violation when", () => {
    it("button has a title attribute", () => {
      const violations = runRule(rule, `<button title="Save document">💾</button>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("tooltip/dismissable");
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.criteria).toContain("wcag22:1.4.13");
      expect(violations[0]?.criteria).toContain("wcag21:1.4.13");
      expect(violations[0]?.suggestion).toMatch(/aria-label="Save document"/);
    });

    it("anchor with href has a title attribute", () => {
      const violations = runRule(rule, `<a href="/help" title="Help center">Help</a>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toMatch(/<a>/);
    });

    it("input has a title attribute", () => {
      const violations = runRule(rule, `<input type="text" title="Enter your full name" />`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toMatch(/<input>/);
    });

    it("select has a title attribute", () => {
      const violations = runRule(
        rule,
        `<select title="Choose a country"><option>UK</option></select>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("multiple interactive elements with title each fire", () => {
      const violations = runRule(
        rule,
        `<div><button title="A">a</button><button title="B">b</button></div>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(2);
    });

    it("truncates long title values in messaging", () => {
      const longTitle = "This is a very very very very very long descriptive title indeed";
      const violations = runRule(rule, `<button title="${longTitle}">x</button>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toMatch(/\.\.\./);
    });
  });

  describe("HTML: does not fire when", () => {
    it("abbr has a title (canonical legitimate use)", () => {
      const violations = runRule(
        rule,
        `<p>The <abbr title="World Health Organization">WHO</abbr> said so.</p>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("dfn has a title", () => {
      const violations = runRule(
        rule,
        `<p><dfn title="A widget is a small device">widget</dfn></p>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("title is absent on the interactive element", () => {
      const violations = runRule(rule, `<button>Save</button>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("title is the empty string", () => {
      const violations = runRule(rule, `<button title="">Save</button>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("title is whitespace-only", () => {
      const violations = runRule(rule, `<button title="   ">Save</button>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("anchor without href has a title (anchor is non-interactive)", () => {
      const violations = runRule(rule, `<a title="Section anchor">x</a>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("input type=hidden has a title", () => {
      const violations = runRule(
        rule,
        `<input type="hidden" name="csrf" title="CSRF token" value="abc" />`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("non-interactive span has a title", () => {
      const violations = runRule(rule, `<span title="metadata">label</span>`, {
        filePath: "page.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("HTML: edge cases", () => {
    it("div with role='button' and title fires", () => {
      const violations = runRule(
        rule,
        `<div role="button" tabindex="0" title="Open menu">☰</div>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toMatch(/<div>/);
    });

    it("span with role='link' and title fires", () => {
      const violations = runRule(
        rule,
        `<span role="link" tabindex="0" title="Open profile">user</span>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("summary element with title fires (interactive disclosure)", () => {
      const violations = runRule(
        rule,
        `<details><summary title="Click to expand">More</summary></details>`,
        { filePath: "page.html" },
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: fires a violation when", () => {
    it("button JSX has a title prop", () => {
      const violations = runRule(rule, `<button title="Save">💾</button>`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("tooltip/dismissable");
    });

    it("anchor JSX with href has a title prop", () => {
      const violations = runRule(rule, `<a href="/help" title="Help">?</a>`);
      expect(violations).toHaveLength(1);
    });

    it("expression-valued title on a button fires", () => {
      const violations = runRule(
        rule,
        `const label = "Save"; const x = <button title={label}>💾</button>;`,
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("custom Tooltip component has a title prop (out of scope)", () => {
      const violations = runRule(
        rule,
        `const x = <Tooltip title="hi"><button>x</button></Tooltip>;`,
      );
      expect(violations).toHaveLength(0);
    });

    it("button has aria-label instead of title", () => {
      const violations = runRule(rule, `<button aria-label="Save">💾</button>`);
      expect(violations).toHaveLength(0);
    });

    it("abbr in JSX with title is exempt", () => {
      const violations = runRule(
        rule,
        `const x = <abbr title="World Health Organization">WHO</abbr>;`,
      );
      expect(violations).toHaveLength(0);
    });
  });
});
