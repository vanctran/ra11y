import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/landmark-main.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/landmark-main", () => {
  describe("fires when", () => {
    it("a document has no <main> at all", () => {
      const v = runRule(rule, "<html><body><header>nav</header><div>content</div></body></html>", {
        filePath: "a.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("no <main>");
    });

    it("a document has two <main> elements inside a page-like layout", () => {
      const v = runRule(
        rule,
        "<html><body><header>h</header><main>one</main><main>two</main><footer>f</footer></body></html>",
        { filePath: "a.html" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("2 <main>");
    });

    it('a role="main" div followed by a <main> counts as two', () => {
      const v = runRule(
        rule,
        '<html><body><header>h</header><div role="main">a</div><main>b</main></body></html>',
        { filePath: "a.html" },
      );
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("a document has exactly one <main>", () => {
      const v = runRule(
        rule,
        "<html><body><header>nav</header><main>content</main></body></html>",
        { filePath: "a.html" },
      );
      expect(v).toHaveLength(0);
    });

    it('a role="main" substitutes for <main>', () => {
      const v = runRule(rule, '<html><body><div role="main">x</div></body></html>', {
        filePath: "a.html",
      });
      expect(v).toHaveLength(0);
    });

    it("the document has no <body> (likely a fragment / component)", () => {
      const v = runRule(rule, "<div>just a fragment</div>", { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });

    it("the document is minimal (no landmarks, no multi-block body)", () => {
      // Don't nag simple documents — if there's nothing that looks
      // like a real page layout, a missing <main> isn't worth
      // flagging.
      const v = runRule(rule, '<html><body><p>hi</p><img src="x" alt="y"></body></html>', {
        filePath: "a.html",
      });
      expect(v).toHaveLength(0);
    });

    it("the file is JSX (router layouts handle landmarks)", () => {
      const v = runRule(rule, "<div><Header /><Content /></div>", { filePath: "a.tsx" });
      expect(v).toHaveLength(0);
    });
  });
});
