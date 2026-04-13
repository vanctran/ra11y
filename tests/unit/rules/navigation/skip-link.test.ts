import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/navigation/skip-link.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule navigation/skip-link", () => {
  describe("fires when", () => {
    it("a page with a multi-link nav has no skip link", () => {
      const html = `
        <html><body>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <main id="main">Content</main>
        </body></html>`;
      const v = runRule(rule, html, { filePath: "a.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("No skip link");
    });

    it("the first link is not an in-page anchor", () => {
      const html = `
        <html><body>
          <a href="/external">External</a>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <main id="main">x</main>
        </body></html>`;
      const v = runRule(rule, html, { filePath: "a.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("not a skip link");
    });

    it("the skip link targets an id that does not exist", () => {
      const html = `
        <html><body>
          <a href="#missing">Skip</a>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <main id="main">x</main>
        </body></html>`;
      const v = runRule(rule, html, { filePath: "a.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("#missing");
    });
  });

  describe("does NOT fire when", () => {
    it("a valid skip link precedes the nav", () => {
      const html = `
        <html><body>
          <a href="#main">Skip to main content</a>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <main id="main">x</main>
        </body></html>`;
      const v = runRule(rule, html, { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });

    it("the document has no <nav> at all", () => {
      const v = runRule(rule, "<html><body><p>content only</p></body></html>", {
        filePath: "a.html",
      });
      expect(v).toHaveLength(0);
    });

    it("the nav has only one link (not worth skipping)", () => {
      const html = `<html><body><nav><a href="/">Home</a></nav><main id="main">x</main></body></html>`;
      const v = runRule(rule, html, { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });

    it("the file is not HTML", () => {
      const v = runRule(rule, "<nav><a>x</a></nav>", { filePath: "a.tsx" });
      expect(v).toHaveLength(0);
    });
  });
});
