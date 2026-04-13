import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/pointer/target-size.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule pointer/target-size", () => {
  describe("fires when (CSS)", () => {
    it("button selector pins width and height below 24px", () => {
      const v = runRule(rule, ".icon-btn { width: 20px; height: 20px; }", { filePath: "a.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("20×20");
      expect(v[0]?.suggestion).toContain("24px");
    });

    it("min-width and min-height under threshold without padding", () => {
      const v = runRule(rule, "button.compact { min-width: 16px; min-height: 16px; }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("16×16");
    });

    it("input[type=checkbox] sized below threshold", () => {
      const v = runRule(rule, 'input[type="checkbox"] { width: 12px; height: 12px; }', {
        filePath: "a.css",
      });
      expect(v).toHaveLength(1);
    });
  });

  describe("fires when (JSX/Tailwind)", () => {
    it("flags a button with `w-4 h-4` (16x16)", () => {
      const v = runRule(rule, '<button className="w-4 h-4">x</button>', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("16×16");
      expect(v[0]?.suggestion).toContain("w-6 h-6");
    });

    it("flags a Tailwind arbitrary value `w-[20px] h-[20px]`", () => {
      const v = runRule(rule, '<button className="w-[20px] h-[20px]">x</button>', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("20×20");
    });

    it("flags a div with role=button sized too small", () => {
      const v = runRule(rule, '<div role="button" className="w-5 h-5" />', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("size meets the 24x24 threshold", () => {
      const v = runRule(rule, ".icon-btn { width: 24px; height: 24px; }", { filePath: "a.css" });
      expect(v).toHaveLength(0);
    });

    it("Tailwind `w-6 h-6` (24x24)", () => {
      const v = runRule(rule, '<button className="w-6 h-6">x</button>', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(0);
    });

    it("padding compensates for an undersized box", () => {
      const v = runRule(rule, ".icon-btn { width: 16px; height: 16px; padding: 4px; }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(0);
    });

    it("interactive element is inside a <p> (Inline exception)", () => {
      const v = runRule(rule, '<p>read <a href="#" className="w-4 h-4">more</a> here</p>', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(0);
    });

    it("input[type=range] is user-agent-determined", () => {
      const v = runRule(rule, '<input type="range" className="w-4 h-4" />', {
        filePath: "a.tsx",
      });
      expect(v).toHaveLength(0);
    });

    it("CSS selector is non-interactive (.card div)", () => {
      const v = runRule(rule, ".card { width: 16px; height: 16px; }", { filePath: "a.css" });
      expect(v).toHaveLength(0);
    });

    it("value uses calc() (unresolvable)", () => {
      const v = runRule(rule, "button { width: calc(2rem - 4px); height: calc(2rem - 4px); }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("metadata", () => {
    it("satisfies wcag22:2.5.8", () => {
      expect(rule.satisfies).toContain("wcag22:2.5.8");
    });

    it("severity is warning", () => {
      expect(rule.severity).toBe("warning");
    });
  });
});
