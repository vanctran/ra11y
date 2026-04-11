import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/navigation/link-descriptive-text.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule navigation/link-descriptive-text", () => {
  describe("HTML: fires on generic phrases", () => {
    it("'click here'", () => {
      const v = runRule(rule, `<a href="/docs">click here</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
    });

    it("'here'", () => {
      const v = runRule(rule, `<p>See <a href="/settings">here</a> for more.</p>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("'read more'", () => {
      const v = runRule(rule, `<a href="/x">Read more</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
    });

    it("'link'", () => {
      const v = runRule(rule, `<a href="/x">link</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
    });

    it("'click here →' (trailing punctuation stripped)", () => {
      const v = runRule(rule, `<a href="/x">Click here →</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML: does NOT fire when", () => {
    it("the link text is descriptive", () => {
      const v = runRule(rule, `<a href="/docs/api">Read the API reference</a>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("aria-label overrides the generic visible text", () => {
      const v = runRule(rule, `<a href="/api" aria-label="API reference">click here</a>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("the element has no href (not a real link)", () => {
      const v = runRule(rule, `<a>click here</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it("text is similar but not in the list (e.g., 'here we go')", () => {
      const v = runRule(rule, `<a href="/x">here we go</a>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });
  });

  describe("JSX: covers <a>, <Link>, <NavLink>", () => {
    it("fires on <a href='/x'>click here</a>", () => {
      const v = runRule(rule, `const X = <a href="/x">click here</a>;`);
      expect(v).toHaveLength(1);
    });

    it("fires on <Link to='/x'>read more</Link>", () => {
      const v = runRule(rule, `const X = <Link to="/x">read more</Link>;`);
      expect(v).toHaveLength(1);
    });

    it("fires on <NavLink to='/x'>here</NavLink>", () => {
      const v = runRule(rule, `const X = <NavLink to="/x">here</NavLink>;`);
      expect(v).toHaveLength(1);
    });

    it("does not fire when aria-label is set", () => {
      const v = runRule(rule, `const X = <Link to="/x" aria-label="Open settings">here</Link>;`);
      expect(v).toHaveLength(0);
    });

    it("does not fire on descriptive JSX link text", () => {
      const v = runRule(rule, `const X = <a href="/x">Open the settings panel</a>;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("suggestion quality", () => {
    it("derives a destination hint from the href", () => {
      const v = runRule(rule, `<a href="/docs/api-reference">click here</a>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain("api reference");
    });

    it("handles query strings and hashes in the href", () => {
      const v = runRule(rule, `<a href="/docs/api?foo=bar#section">click here</a>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain("api");
    });
  });

  it("cites wcag22:2.4.4 and wcag21:2.4.4", () => {
    expect(rule.satisfies).toContain("wcag22:2.4.4");
    expect(rule.satisfies).toContain("wcag21:2.4.4");
  });
});
