import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/motion/pause-stop-hide.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule motion/pause-stop-hide", () => {
  describe("HTML marquee: fires when", () => {
    it("marquee element is present", () => {
      const v = runRule(rule, `<marquee>Breaking news</marquee>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("<marquee>");
    });

    it("multiple marquees each fire", () => {
      const v = runRule(rule, `<marquee>A</marquee><marquee>B</marquee>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(2);
    });

    it("nested marquee in a div fires", () => {
      const v = runRule(rule, `<div><marquee>Scroll</marquee></div>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML marquee: does NOT fire when", () => {
    it("no marquee element", () => {
      const v = runRule(rule, `<div>Static content</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });
  });

  describe("CSS animation: fires when", () => {
    it("animation property without reduced-motion guard", () => {
      const v = runRule(rule, `.spinner { animation: spin 1s infinite; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("prefers-reduced-motion");
    });

    it("transition property without reduced-motion guard", () => {
      const v = runRule(rule, `.fade { transition: opacity 0.3s ease; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
    });

    it("animation-name without reduced-motion guard", () => {
      const v = runRule(rule, `.pulse { animation-name: pulse; animation-duration: 2s; }`, {
        filePath: "styles.css",
      });
      // One violation per rule (first matching property)
      expect(v).toHaveLength(1);
    });
  });

  describe("CSS animation: does NOT fire when", () => {
    it("animation is inside prefers-reduced-motion query", () => {
      const src = `@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("animation value is none", () => {
      const v = runRule(rule, `.x { animation: none; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("transition value is 0s", () => {
      const v = runRule(rule, `.x { transition: 0s; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("no animation or transition properties", () => {
      const v = runRule(rule, `.box { color: red; padding: 10px; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("animation outside reduced-motion query fires even when query exists elsewhere", () => {
      const src = [
        `.spinner { animation: spin 1s infinite; }`,
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
      ].join("\n");
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain(".spinner");
    });

    it("animation inside nested @supports inside @media reduced-motion is guarded", () => {
      const src = `@media (prefers-reduced-motion: reduce) { @supports (animation: none) { .x { animation: none; } } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("suggestion includes the selector and property", () => {
      const v = runRule(rule, `.card { transition: transform 0.2s; }`, {
        filePath: "styles.css",
      });
      expect(v[0]?.suggestion).toContain(".card");
      expect(v[0]?.suggestion).toContain("transition");
    });

    it("marquee suggestion recommends prefers-reduced-motion alternative", () => {
      const v = runRule(rule, `<marquee>News</marquee>`, { filePath: "index.html" });
      expect(v[0]?.suggestion).toContain("prefers-reduced-motion");
    });

    it("recognizes the canonical MDN universal override and suppresses per-selector findings", () => {
      const src = [
        `.spinner { animation: spin 1s infinite; }`,
        `.fade { transition: opacity 0.3s; }`,
        `@media (prefers-reduced-motion: reduce) {`,
        `  *, *::before, *::after {`,
        `    animation-duration: 0.01ms !important;`,
        `    transition-duration: 0.01ms !important;`,
        `  }`,
        `}`,
      ].join("\n");
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("universal override with animation: none also counts as a full guard", () => {
      const src = [
        `.spinner { animation: spin 1s infinite; }`,
        `@media (prefers-reduced-motion: reduce) {`,
        `  * { animation: none; transition: none; }`,
        `}`,
      ].join("\n");
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("non-universal rule inside prefers-reduced-motion does not act as global guard", () => {
      const src = [
        `.spinner { animation: spin 1s infinite; }`,
        `.other { animation: bounce 2s; }`,
        `@media (prefers-reduced-motion: reduce) {`,
        `  .spinner { animation: none; }`,
        `}`,
      ].join("\n");
      const v = runRule(rule, src, { filePath: "styles.css" });
      // Both .spinner (outside-query copy) and .other still fire — a specific
      // per-selector guard doesn't cover the whole stylesheet. Only a universal
      // *, *::before, *::after override does.
      expect(v.length).toBe(2);
    });
  });

  it("cites wcag22:2.2.2 and wcag21:2.2.2", () => {
    expect(rule.satisfies).toContain("wcag22:2.2.2");
    expect(rule.satisfies).toContain("wcag21:2.2.2");
  });
});
