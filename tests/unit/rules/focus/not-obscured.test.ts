import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/focus/not-obscured.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule focus/not-obscured", () => {
  describe("fires when", () => {
    it("sticky header at top:0 with no scroll-padding", () => {
      const src = `.site-header { position: sticky; top: 0; height: 64px; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain(".site-header");
      expect(v[0]?.message).toContain("scroll-padding-top");
    });

    it("fixed header at top:0 with no scroll-padding", () => {
      const src = `.nav { position: fixed; top: 0; height: 80px; width: 100%; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain(".nav");
    });

    it("sticky footer at bottom:0 with no scroll-padding-bottom", () => {
      const src = `.app-footer { position: fixed; bottom: 0; height: 60px; width: 100%; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("scroll-padding-bottom");
      expect(v[0]?.message).toContain("bottom");
    });

    it("scroll-padding set to zero does not count", () => {
      const src = `
        html { scroll-padding-top: 0; }
        .header { position: fixed; top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("scroll-padding-top on a non-container selector does not count", () => {
      const src = `
        .scroll-region { scroll-padding-top: 64px; }
        .header { position: fixed; top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("scroll-padding-top is set on html", () => {
      const src = `
        html { scroll-padding-top: 64px; }
        .header { position: sticky; top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("scroll-padding-bottom is set on body for a fixed footer", () => {
      const src = `
        body { scroll-padding-bottom: 80px; }
        .footer { position: fixed; bottom: 0; height: 80px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("position is static / relative / absolute (not fixed/sticky)", () => {
      const src = `
        .a { position: relative; top: 0; }
        .b { position: absolute; top: 0; height: 64px; }
        .c { top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("no top/bottom anchoring offset", () => {
      const src = `.bar { position: fixed; left: 10px; right: 10px; height: 64px; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("scroll-padding shorthand on html covers top and bottom", () => {
      const src = `
        html { scroll-padding: 64px; }
        .header { position: sticky; top: 0; height: 64px; }
        .footer { position: fixed; bottom: 0; height: 60px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("tiny floating affordance (40x40px) is skipped", () => {
      const src = `.chat-bubble { position: fixed; bottom: 0; width: 40px; height: 40px; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("scroll-padding 4-value shorthand: top 64px, bottom 80px", () => {
      const src = `
        html { scroll-padding: 64px 0 80px 0; }
        .header { position: sticky; top: 0; height: 64px; }
        .footer { position: fixed; bottom: 0; height: 80px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("scroll-padding 4-value shorthand with bottom:0 still flags footer", () => {
      const src = `
        html { scroll-padding: 64px 0 0 0; }
        .footer { position: fixed; bottom: 0; height: 80px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain(".footer");
    });

    it(":root selector counts as a scroll container", () => {
      const src = `
        :root { scroll-padding-top: 64px; }
        .header { position: sticky; top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("scroll-padding-block longhand covers top and bottom", () => {
      const src = `
        html { scroll-padding-block: 64px; }
        .header { position: sticky; top: 0; height: 64px; }
      `;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("sticky inside @media still fires", () => {
      const src = `@media (min-width: 600px) { .h { position: sticky; top: 0; height: 64px; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("rem unit on tiny affordance dimensions is parsed and skipped", () => {
      const src = `.fab { position: fixed; bottom: 0; width: 2.5rem; height: 2.5rem; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });
  });

  describe("suggestion quality", () => {
    it("includes the rule selector and the missing property name", () => {
      const src = `.site-header { position: sticky; top: 0; height: 64px; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v[0]?.suggestion).toContain(".site-header");
      expect(v[0]?.suggestion).toContain("scroll-padding-top");
      expect(v[0]?.suggestion).toContain("64px");
    });

    it("suggests scroll-padding-bottom for footer anchors", () => {
      const src = `.app-footer { position: fixed; bottom: 0; height: 80px; }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v[0]?.suggestion).toContain("scroll-padding-bottom");
      expect(v[0]?.suggestion).toContain("80px");
    });
  });

  it("cites only wcag22:2.4.11 (new in WCAG 2.2)", () => {
    expect(rule.satisfies).toEqual(["wcag22:2.4.11"]);
  });
});
