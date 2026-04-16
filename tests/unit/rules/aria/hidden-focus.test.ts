import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/hidden-focus.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/hidden-focus", () => {
  describe("HTML: fires when", () => {
    it('a <button aria-hidden="true"> is directly focusable', () => {
      const v = runRule(rule, `<button aria-hidden="true">Close</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("aria-hidden");
      expect(v[0]?.message).toContain("button");
    });

    it("an <a href> is hidden", () => {
      const v = runRule(rule, `<a href="/x" aria-hidden="true">link</a>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("an <input> (default type) is hidden", () => {
      const v = runRule(rule, `<input aria-hidden="true" />`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it('a tabindex="0" span is hidden', () => {
      const v = runRule(rule, `<span aria-hidden="true" tabindex="0">x</span>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("a positive tabindex is hidden", () => {
      const v = runRule(rule, `<div aria-hidden="true" tabindex="2">x</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("an aria-hidden wrapper contains a focusable descendant", () => {
      const v = runRule(rule, `<div aria-hidden="true"><button>Inside</button></div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("descendant");
    });

    it("an aria-hidden wrapper contains a deeply nested focusable", () => {
      const v = runRule(
        rule,
        `<div aria-hidden="true"><section><p><a href="/x">link</a></p></section></div>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
    });

    it("a <video controls> is aria-hidden", () => {
      const v = runRule(rule, `<video aria-hidden="true" controls></video>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML: does NOT fire when", () => {
    it("a visible button has no aria-hidden", () => {
      const v = runRule(rule, `<button>Visible</button>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it('a <span aria-hidden="true"> has no focusable descendants', () => {
      const v = runRule(rule, `<div aria-hidden="true"><span>Decorative</span></div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('a <span aria-hidden="true" tabindex="-1"> is out of tab order', () => {
      const v = runRule(rule, `<span aria-hidden="true" tabindex="-1">Icon</span>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('an aria-hidden="false" element is not hidden', () => {
      const v = runRule(rule, `<button aria-hidden="false">Open</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('an <input type="hidden"> is not focusable', () => {
      const v = runRule(rule, `<input type="hidden" aria-hidden="true" value="x" />`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("an <a> with no href is not natively focusable", () => {
      const v = runRule(rule, `<a aria-hidden="true">placeholder</a>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("a <video> without controls is aria-hidden", () => {
      const v = runRule(rule, `<video aria-hidden="true"></video>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('descendants with tabindex="-1" are safe', () => {
      const v = runRule(rule, `<div aria-hidden="true"><button tabindex="-1">x</button></div>`, {
        filePath: "index.html",
      });
      // inner button is natively focusable — still fires
      expect(v).toHaveLength(1);
    });
  });

  describe("JSX: fires when", () => {
    it('a <button aria-hidden="true"> is hidden', () => {
      const v = runRule(rule, `const X = <button aria-hidden="true">Close</button>;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
    });

    it("a focusable descendant lives inside aria-hidden", () => {
      const v = runRule(rule, `const X = <div aria-hidden="true"><a href="/x">link</a></div>;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("descendant");
    });

    it("a span with tabIndex={0} is aria-hidden (JSX camelCase)", () => {
      const v = runRule(rule, `const X = <span aria-hidden="true" tabIndex="0">x</span>;`);
      expect(v).toHaveLength(1);
    });
  });

  describe("JSX: does NOT fire when", () => {
    it("button has no aria-hidden", () => {
      const v = runRule(rule, `const X = <button>Visible</button>;`);
      expect(v).toHaveLength(0);
    });

    it("aria-hidden span is purely decorative with tabIndex=-1", () => {
      const v = runRule(rule, `const X = <span aria-hidden="true" tabIndex="-1">Icon</span>;`);
      expect(v).toHaveLength(0);
    });

    it("aria-hidden wrapper only contains inert spans", () => {
      const v = runRule(
        rule,
        `const X = <div aria-hidden="true"><span>Decorative text</span></div>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("aria-hidden wrapper contains an opaque React component (not descended)", () => {
      const v = runRule(rule, `const X = <div aria-hidden="true"><CustomIcon /></div>;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("metadata and suggestion quality", () => {
    it("cites wcag22:4.1.2 and wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });

    it("has severity error", () => {
      expect(rule.severity).toBe("error");
    });

    it("direct-focus suggestion mentions the element", () => {
      const v = runRule(rule, `<button aria-hidden="true">Close</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain("tabindex");
    });

    it("descendant suggestion mentions inert or tabindex", () => {
      const v = runRule(rule, `<div aria-hidden="true"><button>Inside</button></div>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toMatch(/inert|tabindex/);
    });

    it("emits structured fixPaths with inert as primary for direct-focus violations", () => {
      // suggest_fix surfaces fixPaths so the agent gets labeled
      // alternatives instead of echoing prose. The primary should be
      // `inert` because it handles both focus removal AND AT hiding in
      // one attribute — the two alternatives are the partial fixes.
      const v = runRule(rule, `<button aria-hidden="true">Close</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.fixPaths?.primary.label).toContain("inert");
      expect(v[0]?.fixPaths?.alternatives).toHaveLength(2);
      const altLabels = v[0]?.fixPaths?.alternatives.map((a) => a.label).join(" | ") ?? "";
      expect(altLabels).toContain("remove aria-hidden");
      expect(altLabels).toContain("non-focusable");
    });

    it("emits structured fixPaths with inert as primary for descendant violations", () => {
      const v = runRule(rule, `<div aria-hidden="true"><button>Inside</button></div>`, {
        filePath: "index.html",
      });
      expect(v[0]?.fixPaths?.primary.label).toContain("inert");
      expect(v[0]?.fixPaths?.alternatives).toHaveLength(2);
    });
  });
});
