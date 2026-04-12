import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/focus/outline-visible.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule focus/outline-visible", () => {
  describe("fires when", () => {
    it("outline: none on :focus with no replacement", () => {
      const v = runRule(rule, `a:focus { outline: none; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("outline");
    });

    it("outline: 0 on :focus with no replacement", () => {
      const v = runRule(rule, `button:focus { outline: 0; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("outline-style: none on :focus-visible with no replacement", () => {
      const v = runRule(rule, `input:focus-visible { outline-style: none; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
    });

    it("outline: none inside compound selector with :focus", () => {
      const v = runRule(rule, `.btn:focus { outline: none; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain(".btn:focus");
    });

    it("outline: 0px on :focus with no replacement", () => {
      const v = runRule(rule, `a:focus { outline: 0px; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("outline: none with box-shadow replacement", () => {
      const v = runRule(rule, `a:focus { outline: none; box-shadow: 0 0 0 2px #0066cc; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("outline: none with border-color replacement", () => {
      const v = runRule(rule, `input:focus { outline: none; border-color: #0066cc; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("outline: none with background-color replacement", () => {
      const v = runRule(rule, `.tab:focus-visible { outline: none; background-color: #e0e0ff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("outline: none then outline: 2px solid blue (reset-then-replace pattern)", () => {
      const v = runRule(rule, `a:focus { outline: none; outline: 2px solid blue; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("no :focus pseudo-class at all", () => {
      const v = runRule(rule, `a { outline: none; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("outline set to a visible value on :focus", () => {
      const v = runRule(rule, `a:focus { outline: 2px solid red; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("no outline declaration at all on :focus", () => {
      const v = runRule(rule, `a:focus { color: blue; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("outline: none inside @media still fires", () => {
      const src = `@media (max-width: 600px) { a:focus { outline: none; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("multiple rules — only the violating one fires", () => {
      const src = [
        `a:focus { outline: none; box-shadow: 0 0 0 2px blue; }`,
        `button:focus { outline: none; }`,
      ].join("\n");
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("button:focus");
    });

    it("outline: none with border (shorthand) replacement", () => {
      const v = runRule(rule, `.x:focus { outline: none; border: 2px solid blue; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("outline: none with text-decoration replacement", () => {
      const v = runRule(rule, `.link:focus { outline: none; text-decoration: underline; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("suggestion quality", () => {
    it("includes the selector and mentions outline replacement", () => {
      const v = runRule(rule, `a:focus { outline: none; }`, { filePath: "styles.css" });
      expect(v[0]?.suggestion).toContain("a:focus");
      expect(v[0]?.suggestion).toContain("outline");
    });
  });

  it("cites wcag22:2.4.7 and wcag21:2.4.7", () => {
    expect(rule.satisfies).toContain("wcag22:2.4.7");
    expect(rule.satisfies).toContain("wcag21:2.4.7");
  });
});
