import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/contrast/enhanced.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule contrast/enhanced (WCAG 1.4.6 AAA)", () => {
  describe("fires when", () => {
    it("normal text has a ratio below 7:1 but above 4.5:1", () => {
      // #767676 on white = ~4.54:1 — passes AA, fails AAA.
      const v = runRule(rule, `.label { color: #767676; background-color: #ffffff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("7:1");
      expect(v[0]?.message).toContain("WCAG 1.4.6");
    });

    it("flags pairs that barely pass AA (5:1 range)", () => {
      const v = runRule(rule, `.sub { color: #777; background: #fff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
    });

    it("large text fails when ratio < 4.5:1", () => {
      // #999 on white ~2.85:1, with 18pt → fails AAA large (4.5:1).
      const v = runRule(rule, `.heading { color: #999; background: #fff; font-size: 20pt; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("large text");
    });
  });

  describe("does NOT fire when", () => {
    it("normal text meets 7:1 (near-black on white)", () => {
      const v = runRule(rule, `.body { color: #222222; background-color: #ffffff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("large text meets 4.5:1", () => {
      const v = runRule(rule, `.heading { color: #555; background: #fff; font-size: 24pt; }`, {
        filePath: "styles.css",
      });
      // #555 on white = ~7.45:1 — well above AAA large.
      expect(v).toHaveLength(0);
    });

    it("the background is transparent (can't compute)", () => {
      const v = runRule(rule, `.overlay { color: #aaa; background: transparent; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("the file is not CSS", () => {
      const v = runRule(rule, `<p style="color:#aaa">x</p>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });
  });

  it("cites WCAG 1.4.6 across both 2.1 and 2.2", () => {
    expect(rule.satisfies).toContain("wcag22:1.4.6");
    expect(rule.satisfies).toContain("wcag21:1.4.6");
  });
});
