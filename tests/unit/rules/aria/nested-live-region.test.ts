import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/nested-live-region.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/nested-live-region", () => {
  describe("HTML: fires when", () => {
    it("role=status is nested inside an aria-live='polite' ancestor", () => {
      const violations = runRule(
        rule,
        `<ul aria-live="polite"><li role="status">Saved.</li></ul>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/nested-live-region");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain(`<li role="status">`);
      expect(violations[0]?.message).toContain(`aria-live="polite"`);
    });

    it("aria-live='polite' is nested inside an aria-live='polite' ancestor", () => {
      const violations = runRule(
        rule,
        `<section aria-live="polite"><div aria-live="polite">Hello</div></section>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`<div aria-live="polite">`);
    });

    it("aria-live='assertive' is nested inside a role=log ancestor", () => {
      const violations = runRule(
        rule,
        `<div role="log"><p aria-live="assertive">Critical</p></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`<p`);
      expect(violations[0]?.message).toContain(`aria-live="assertive"`);
      expect(violations[0]?.message).toContain(`role="log"`);
    });

    it("role=alert is nested several levels deep inside role=status", () => {
      const violations = runRule(
        rule,
        `<div role="status"><section><p><span role="alert">Error</span></p></section></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`role="alert"`);
      expect(violations[0]?.message).toContain(`role="status"`);
    });

    it("describes both inner and outer in the suggestion", () => {
      const violations = runRule(
        rule,
        `<div aria-live="polite"><div role="status">Saved</div></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("one live region");
    });
  });

  describe("HTML: does not fire when", () => {
    it("a single aria-live region has no nested live descendants", () => {
      const violations = runRule(
        rule,
        `<ul aria-live="polite"><li>Item A</li><li>Item B</li></ul>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("two live regions are siblings rather than nested", () => {
      const violations = runRule(
        rule,
        `<div role="status">Saved.</div><div role="alert">Error.</div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("the ancestor uses aria-live='off'", () => {
      const violations = runRule(
        rule,
        `<section aria-live="off"><div role="status">Saved.</div></section>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("the descendant uses aria-live='off' under a polite ancestor", () => {
      const violations = runRule(
        rule,
        `<div aria-live="polite"><div aria-live="off">Inert</div></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("ancestor has role=timer (implicitly aria-live='off')", () => {
      const violations = runRule(rule, `<div role="timer"><span role="status">Tick</span></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("descendant has role=marquee under a live region (implicitly aria-live='off')", () => {
      const violations = runRule(
        rule,
        `<div aria-live="polite"><div role="marquee">Scrolling</div></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("there are no live regions in the document", () => {
      const violations = runRule(
        rule,
        `<main><article><h1>Title</h1><p>Body</p></article></main>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("role='status' is nested inside an aria-live='polite' parent", () => {
      const violations = runRule(
        rule,
        `export const View = () => (
          <ul aria-live="polite" aria-relevant="additions">
            <li role="status">Saved.</li>
          </ul>
        );`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("aria/nested-live-region");
      expect(violations[0]?.message).toContain(`<li role="status">`);
    });

    it("a sr-only live region is nested inside an outer role='status' bubble", () => {
      const violations = runRule(
        rule,
        `export const View = () => (
          <div role="status">
            <div className="sr-only" aria-live="polite">{content}</div>
          </div>
        );`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(`<div aria-live="polite">`);
    });
  });

  describe("JSX: does not fire when", () => {
    it("the live region declarations are split across PascalCase component boundaries", () => {
      // The outer <Notifier> is opaque to single-file analysis — even if at
      // runtime it renders an aria-live container, we can't see that here,
      // so the inner role="status" must not fire from this file alone.
      const violations = runRule(
        rule,
        `export const Inner = () => <div role="status">Saved.</div>;`,
      );
      expect(violations).toHaveLength(0);
    });

    it("the descendant carries aria-live='off' to opt out", () => {
      const violations = runRule(
        rule,
        `export const View = () => (
          <div aria-live="polite">
            <div aria-live="off">{cached}</div>
          </div>
        );`,
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("emits one violation per nested descendant — not one per ancestor pair", () => {
      const violations = runRule(
        rule,
        `<div aria-live="polite">
          <div role="status">First.</div>
          <div role="alert">Second.</div>
        </div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(2);
    });

    it("multi-token role uses the first token to decide live-ness", () => {
      // role="status alert" — the first token is the recognized role per
      // ARIA's fallback resolution; this is a status nested under polite.
      const violations = runRule(
        rule,
        `<div aria-live="polite"><div role="status alert">Saved.</div></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("case-insensitive matching on role and aria-live tokens", () => {
      const violations = runRule(
        rule,
        `<div ARIA-LIVE="Polite"><div ROLE="Status">Saved.</div></div>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });
  });
});
