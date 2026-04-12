import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/nested-interactive.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/nested-interactive", () => {
  describe("HTML: fires when", () => {
    it("button is nested inside a[href]", () => {
      const violations = runRule(
        rule,
        `<a href="/card"><button type="button">Action</button></a>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("semantics/nested-interactive");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("<button>");
      expect(violations[0]?.message).toContain("<a href>");
    });

    it("a[href] is nested inside another a[href]", () => {
      const violations = runRule(
        rule,
        `<a href="/outer"><span><a href="/inner">Inner</a></span></a>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<a href>");
    });

    it("button is nested inside a button", () => {
      const violations = runRule(rule, `<button>Outer <button>Inner</button></button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("input is nested inside a[href]", () => {
      const violations = runRule(rule, `<a href="/x"><input type="text" /></a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<input>");
    });

    it("select is nested inside a button", () => {
      const violations = runRule(
        rule,
        `<button>Pick <select><option>a</option></select></button>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<select>");
    });

    it("an element with role=button is nested inside an a[href]", () => {
      const violations = runRule(rule, `<a href="/x"><span role="button">Do it</span></a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`role="button"`);
    });

    it("textarea is nested inside a[href]", () => {
      const violations = runRule(rule, `<a href="/x"><textarea></textarea></a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("deeply nested: reports the inner/outer pair (not every ancestor)", () => {
      const violations = runRule(
        rule,
        `<a href="/x"><div><section><button>Go</button></section></div></a>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<button>");
    });
  });

  describe("HTML: does not fire when", () => {
    it("a non-interactive element is inside an a[href]", () => {
      const violations = runRule(
        rule,
        `<a href="/x"><span>Text</span><svg aria-hidden="true"></svg></a>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("input type=hidden is inside an a[href]", () => {
      const violations = runRule(rule, `<a href="/x">Label<input type="hidden" value="1" /></a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("an <a> with no href (just an anchor target) contains a button", () => {
      const violations = runRule(rule, `<a name="top"><button type="button">Action</button></a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("a <video> without controls contains a button", () => {
      const violations = runRule(
        rule,
        `<video src="/v.mp4"><button type="button">Play</button></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("two sibling buttons are side-by-side", () => {
      const violations = runRule(rule, `<div><button>One</button><button>Two</button></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("button is nested inside an a[href]", () => {
      const violations = runRule(
        rule,
        `const X = <a href="/x"><button type="button">Go</button></a>;`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<button>");
    });

    it("role=button span is nested inside an a[href]", () => {
      const violations = runRule(rule, `const X = <a href="/x"><span role="button">Go</span></a>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`role="button"`);
    });

    it("role=Button (PascalCase) span is nested inside an a[href] — case-insensitive", () => {
      const violations = runRule(rule, `const X = <a href="/x"><span role="Button">Go</span></a>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`role="button"`);
    });
  });

  describe("JSX: does not fire when", () => {
    it("a PascalCase component is between the outer a[href] and an inner button", () => {
      // PascalCase is opaque — we don't traverse through it, and we
      // don't flag a child of it as nested under an outer native
      // interactive element.
      const violations = runRule(
        rule,
        `const X = <a href="/x"><Card><button>Go</button></Card></a>;`,
      );
      expect(violations).toHaveLength(0);
    });

    it("an a[href] contains only a PascalCase child", () => {
      const violations = runRule(rule, `const X = <a href="/x"><Icon name="chev" /></a>;`);
      expect(violations).toHaveLength(0);
    });

    it("a plain span containing text is inside an a[href]", () => {
      const violations = runRule(rule, `const X = <a href="/x"><span>Settings</span></a>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:4.1.2 and wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });

    it("is document-scoped and severity=error", () => {
      expect(rule.scope).toBe("document");
      expect(rule.severity).toBe("error");
    });
  });
});
