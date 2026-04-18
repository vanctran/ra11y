import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/conflicting-role.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/conflicting-role", () => {
  describe("HTML: fires a violation when", () => {
    it("<button> has role='link'", () => {
      const violations = runRule(rule, `<button role="link">Save</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/conflicting-role");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.criteria).toContain("wcag22:4.1.2");
      expect(violations[0]?.message).toContain("link");
      expect(violations[0]?.message).toContain("button");
    });

    it("<a href> has role='button'", () => {
      const violations = runRule(rule, `<a href="/docs" role="button">Read the docs</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("<button");
    });

    it("<nav> has role='main' (landmark mismatch)", () => {
      const violations = runRule(rule, `<nav role="main">x</nav>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("<main>");
    });

    it("<h1> has role='button' (breaks the rotor outline)", () => {
      const violations = runRule(rule, `<h1 role="button">Title</h1>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("rotor");
    });

    it("<main> has role='navigation'", () => {
      const violations = runRule(rule, `<main role="navigation">x</main>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("<li> has role='button'", () => {
      const violations = runRule(rule, `<ul><li role="button">Click</li></ul>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("list-navigation");
    });
  });

  describe("HTML: does not fire when", () => {
    it("role matches the implicit role (redundant, out of scope)", () => {
      const violations = runRule(rule, `<a href="/x" role="link">x</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("<button role='button'> — redundant, out of scope", () => {
      const violations = runRule(rule, `<button role="button">Save</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("<a role='button'> without href (handler-less anchor used as styled div)", () => {
      const violations = runRule(rule, `<a role="button">Click</a>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("<img role='presentation'> (documented decorative pattern)", () => {
      const violations = runRule(rule, `<img src="deco.png" alt="" role="presentation">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("<div role='button'> — no implicit role to conflict with", () => {
      const violations = runRule(rule, `<div role="button" tabindex="0">Save</div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("<span role='link'> — no implicit role to conflict with", () => {
      const violations = runRule(rule, `<span role="link">x</span>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("element has no role attribute", () => {
      const violations = runRule(rule, `<button>Save</button>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("empty role attribute", () => {
      const violations = runRule(rule, `<button role="">Save</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("role='none' on a heading is honored (presentation override)", () => {
      // role="none" is a documented suppression pattern; a separate rule owns
      // flagging it on interactive elements.
      const violations = runRule(rule, `<h1 role="none">Title</h1>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires a violation when", () => {
    it("<button role='link'>", () => {
      const violations = runRule(rule, `const X = <button role="link">Save</button>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/conflicting-role");
    });

    it("<a href='…' role='button'>", () => {
      const violations = runRule(
        rule,
        `const X = <a href="/docs" role="button">Read the docs</a>;`,
      );
      expect(violations).toHaveLength(1);
    });

    it("<a href={url} role='button'> — href expression still counts as having href", () => {
      const violations = runRule(
        rule,
        `const X = ({ url }) => <a href={url} role="button">Go</a>;`,
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("<a role='button'> without href or handler (styled-div pattern)", () => {
      const violations = runRule(rule, `const X = <a role="button">Click</a>;`);
      expect(violations).toHaveLength(0);
    });

    it("role is an expression (runtime-computed)", () => {
      const violations = runRule(rule, `const X = <button role={dynamicRole}>x</button>;`);
      expect(violations).toHaveLength(0);
    });

    it("<button role='button'> is redundant, not a conflict", () => {
      const violations = runRule(rule, `const X = <button role="button">Save</button>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("multi-role fallback — first token is checked", () => {
      // role="link button" — first token ("link") conflicts with <button>.
      const violations = runRule(rule, `<button role="link button">x</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("role attribute casing is normalized (BUTTON vs button)", () => {
      const violations = runRule(rule, `<button role="LINK">x</button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("<input type='checkbox' role='radio'> — input-type-driven implicit role", () => {
      const violations = runRule(rule, `<input type="checkbox" role="radio">`, {
        filePath: "index.html",
      });
      // checkbox/radio is not in the conflict pairs by default — the
      // rule stays quiet on ambiguous same-family widget swaps. This
      // test pins that behavior so a future widening is intentional.
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
      expect(rule.docs.references[0]).toContain("WCAG22");
    });
  });
});
