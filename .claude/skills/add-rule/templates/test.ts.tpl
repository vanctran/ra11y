import { describe, expect, it } from "bun:test";
import { runRule } from "@/tests/helpers/run-rule";
import { rule } from "@/rules/{{domain}}/{{slug}}";

describe("rule {{domain}}/{{slug}}", () => {
  describe("fires a violation when", () => {
    it("<positive case 1>", () => {
      const violations = runRule(rule, `/* bad fixture snippet */`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("{{domain}}/{{slug}}");
      expect(violations[0]?.suggestion).toMatch(/<specific phrase>/);
    });

    it("<positive case 2>", () => {
      const violations = runRule(rule, `/* bad fixture snippet */`);
      expect(violations).toHaveLength(1);
    });

    it("<positive case 3>", () => {
      const violations = runRule(rule, `/* bad fixture snippet */`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("does not fire when", () => {
    it("<negative case 1>", () => {
      const violations = runRule(rule, `/* good fixture snippet */`);
      expect(violations).toHaveLength(0);
    });

    it("<negative case 2>", () => {
      const violations = runRule(rule, `/* good fixture snippet */`);
      expect(violations).toHaveLength(0);
    });

    it("<negative case 3>", () => {
      const violations = runRule(rule, `/* good fixture snippet */`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("<boundary case>", () => {
      const violations = runRule(rule, `/* boundary snippet */`);
      expect(violations).toHaveLength(0); // or 1, whichever the spec requires
    });
  });
});
