import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/layout/reflow-hardcoded-width.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule layout/reflow-hardcoded-width", () => {
  describe("fires when", () => {
    it("width is a fixed px value larger than 320", () => {
      const v = runRule(rule, ".container { width: 1200px; }", { filePath: "a.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("1200");
    });

    it("min-width forces an overflowing layout", () => {
      const v = runRule(rule, ".wide { min-width: 900px; }", { filePath: "a.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("min-width");
    });

    it("a physical unit (pt/in/cm) is used", () => {
      const v = runRule(rule, ".print { width: 8in; }", { filePath: "a.css" });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("in");
    });
  });

  describe("does NOT fire when", () => {
    it("max-width pins an upper bound only", () => {
      const v = runRule(rule, ".container { max-width: 1200px; }", { filePath: "a.css" });
      expect(v).toHaveLength(0);
    });

    it("width uses a relative unit", () => {
      const v = runRule(rule, ".x { width: 80%; }", { filePath: "a.css" });
      expect(v).toHaveLength(0);
    });

    it("width is below the 320 reflow threshold", () => {
      const v = runRule(rule, ".small { width: 280px; }", { filePath: "a.css" });
      expect(v).toHaveLength(0);
    });

    it("width is inside an @media (min-width) breakpoint", () => {
      const v = runRule(rule, "@media (min-width: 800px) { .container { width: 1200px; } }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(0);
    });

    it("rule targets html or body", () => {
      const v = runRule(rule, "html { width: 100vw; } body { width: 100vw; }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(0);
    });

    it("value uses calc() or var() (unresolvable)", () => {
      const v = runRule(rule, ".x { width: calc(100vw - 40px); } .y { width: var(--w); }", {
        filePath: "a.css",
      });
      expect(v).toHaveLength(0);
    });

    it("file is not CSS", () => {
      const v = runRule(rule, "<div style='width: 1200px'></div>", { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });
  });
});
