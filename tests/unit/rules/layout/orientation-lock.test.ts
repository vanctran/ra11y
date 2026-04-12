import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/layout/orientation-lock.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule layout/orientation-lock", () => {
  describe("fires when", () => {
    it("display: none inside orientation: portrait media query", () => {
      const src = `@media (orientation: portrait) { .app { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("portrait");
      expect(v[0]?.message).toContain("display: none");
    });

    it("display: none inside orientation: landscape media query", () => {
      const src = `@media (orientation: landscape) { .app { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("landscape");
    });

    it("visibility: hidden inside orientation media query", () => {
      const src = `@media (orientation: portrait) { .content { visibility: hidden; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("visibility: hidden");
    });

    it("transform: rotate(90deg) inside orientation media query", () => {
      const src = `@media (orientation: portrait) { body { transform: rotate(90deg); } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("rotate");
    });

    it("transform: rotate(-90deg) inside orientation media query", () => {
      const src = `@media (orientation: landscape) { body { transform: rotate(-90deg); } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("orientation media query with layout-only changes", () => {
      const src = `@media (orientation: portrait) { .sidebar { flex-direction: column; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("display: none in non-orientation media query", () => {
      const src = `@media (max-width: 600px) { .sidebar { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("no @media at all", () => {
      const v = runRule(rule, `.app { display: none; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("orientation media query with font-size change only", () => {
      const src = `@media (orientation: landscape) { h1 { font-size: 2rem; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("transform: rotate(45deg) is not a lock rotation", () => {
      const src = `@media (orientation: portrait) { .icon { transform: rotate(45deg); } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("mixed media features with orientation still flags", () => {
      const src = `@media (max-width: 600px) and (orientation: portrait) { .x { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("rotate(270deg) is treated as a lock rotation", () => {
      const src = `@media (orientation: portrait) { body { transform: rotate(270deg); } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("case-insensitive orientation matching", () => {
      const src = `@media (orientation: Portrait) { .app { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });
  });

  describe("suggestion quality", () => {
    it("suggests adapting layout instead of hiding for display: none", () => {
      const src = `@media (orientation: portrait) { .sidebar { display: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v[0]?.suggestion).toContain("adapt");
      expect(v[0]?.suggestion).toContain(".sidebar");
    });

    it("mentions forced rotation for transform violations", () => {
      const src = `@media (orientation: portrait) { body { transform: rotate(90deg); } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v[0]?.suggestion).toContain("rotating");
      expect(v[0]?.suggestion).toContain("body");
    });
  });

  it("cites wcag22:1.3.4 and wcag21:1.3.4", () => {
    expect(rule.satisfies).toContain("wcag22:1.3.4");
    expect(rule.satisfies).toContain("wcag21:1.3.4");
  });
});
