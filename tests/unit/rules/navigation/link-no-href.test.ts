import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/navigation/link-no-href.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule navigation/link-no-href", () => {
  describe("HTML: fires when", () => {
    it("a has onclick but no href", () => {
      const violations = runRule(rule, `<a onclick="doThing()">Click</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("navigation/link-no-href");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.criteria).toContain("wcag22:2.1.1");
    });
  });

  describe("HTML: does not fire when", () => {
    it("a has a real href", () => {
      const violations = runRule(rule, `<a href="/dashboard" onclick="doThing()">Go</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("a has only href (no handler)", () => {
      const violations = runRule(rule, `<a href="/dashboard">Go</a>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("a has neither href nor onclick (named anchor placeholder)", () => {
      // Bare <a> without href is valid HTML (used to be a named anchor).
      // Without a click handler there's no keyboard trap — the element
      // is just inert text. We only flag the a+onclick combo.
      const violations = runRule(rule, `<a name="section">Section heading</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("href is empty string (still counts as present)", () => {
      // An empty href is bad practice but browser-compatible — it reloads
      // the current URL. That's a separate concern from keyboard-operability.
      const violations = runRule(rule, `<a href="" onclick="doThing()">Go</a>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("a has onClick but no href", () => {
      const violations = runRule(rule, `const X = <a onClick={handle}>Click</a>;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("a has href and onClick", () => {
      const violations = runRule(rule, `const X = <a href="/x" onClick={handle}>Go</a>;`);
      expect(violations).toHaveLength(0);
    });

    it("a has only href", () => {
      const violations = runRule(rule, `const X = <a href="/x">Go</a>;`);
      expect(violations).toHaveLength(0);
    });

    it("custom component (PascalCase Link) is ignored", () => {
      // This rule only applies to lowercase <a>. React component links
      // like Next.js <Link> are a separate question.
      const violations = runRule(rule, `const X = <Link onClick={handle}>Go</Link>;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:2.1.1, wcag21:2.1.1, wcag22:4.1.2, wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:2.1.1");
      expect(rule.satisfies).toContain("wcag21:2.1.1");
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });
  });
});
