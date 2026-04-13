import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/non-empty-label.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/non-empty-label", () => {
  describe("fires when", () => {
    it("an HTML label is empty", () => {
      const v = runRule(rule, '<label for="email"></label><input id="email">', {
        filePath: "a.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("<label> is empty");
    });

    it("an HTML label contains only whitespace", () => {
      const v = runRule(rule, '<label for="x">   \n\t  </label>', { filePath: "a.html" });
      expect(v).toHaveLength(1);
    });

    it("a JSX label is empty", () => {
      const v = runRule(rule, '<label htmlFor="email"></label>', { filePath: "a.tsx" });
      expect(v).toHaveLength(1);
    });
  });

  describe("does NOT fire when", () => {
    it("an HTML label contains visible text", () => {
      const v = runRule(rule, '<label for="email">Email</label>', { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });

    it("a JSX label contains visible text", () => {
      const v = runRule(rule, '<label htmlFor="email">Email</label>', { filePath: "a.tsx" });
      expect(v).toHaveLength(0);
    });

    it("the file has no <label> elements at all", () => {
      const v = runRule(rule, "<input>", { filePath: "a.html" });
      expect(v).toHaveLength(0);
    });
  });

  it("cites WCAG 2.4.6 and 1.3.1 across both 2.1 and 2.2", () => {
    expect(rule.satisfies).toContain("wcag22:2.4.6");
    expect(rule.satisfies).toContain("wcag21:2.4.6");
    expect(rule.satisfies).toContain("wcag22:1.3.1");
  });
});
