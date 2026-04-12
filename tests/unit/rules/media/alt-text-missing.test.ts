import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/media/alt-text-missing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule media/alt-text-missing", () => {
  describe("HTML: fires a violation when", () => {
    it("img has no alt, aria-label, or aria-labelledby", () => {
      const violations = runRule(rule, `<p><img src="chart.png"></p>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("media/alt-text-missing");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.criteria).toContain("wcag22:1.1.1");
    });

    it("img has an empty aria-label (whitespace-only)", () => {
      const violations = runRule(rule, `<img src="x.png" aria-label="   ">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("<input type='image'> is missing alt", () => {
      const violations = runRule(rule, `<input type="image" src="submit.png">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });
  });

  describe("HTML: does not fire when", () => {
    it("img has a meaningful alt", () => {
      const violations = runRule(rule, `<img src="chart.png" alt="Q4 growth 12%">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("img is explicitly decorative via alt=''", () => {
      const violations = runRule(rule, `<img src="flourish.png" alt="">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("img is decorative via role='presentation'", () => {
      const violations = runRule(rule, `<img src="x.png" role="presentation">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("img has aria-label", () => {
      const violations = runRule(rule, `<img src="x.png" aria-label="logo">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("img is aria-hidden", () => {
      const violations = runRule(rule, `<img src="x.png" aria-hidden="true">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires a violation when", () => {
    it("img has no alt prop", () => {
      const violations = runRule(rule, `const X = <img src="chart.png" />;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("media/alt-text-missing");
    });

    it("multiple offending imgs produce multiple violations", () => {
      const src = `const X = <div><img src="a.png" /><img src="b.png" /></div>;`;
      const violations = runRule(rule, src);
      expect(violations).toHaveLength(2);
    });

    it("img inside a component still fires", () => {
      const src = `const X = <Card><img src="thumb.png" /></Card>;`;
      const violations = runRule(rule, src);
      expect(violations).toHaveLength(1);
    });

    it("<input type='image'> without alt fires", () => {
      const violations = runRule(rule, `const X = <input type="image" src="submit.png" />;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("media/alt-text-missing");
    });
  });

  describe("JSX: does not fire when", () => {
    it("img has a string alt", () => {
      const violations = runRule(rule, `const X = <img src="x.png" alt="Logo" />;`);
      expect(violations).toHaveLength(0);
    });

    it("img has an expression alt (runtime-computed)", () => {
      // Static analysis assumes the developer is computing a name at
      // runtime. False-negative but low-signal to flag.
      const violations = runRule(rule, `const X = <img src="x.png" alt={label} />;`);
      expect(violations).toHaveLength(0);
    });

    it("img has alt='' (explicitly decorative)", () => {
      const violations = runRule(rule, `const X = <img src="x.png" alt="" />;`);
      expect(violations).toHaveLength(0);
    });

    it("<input type='image'> with alt does not fire", () => {
      const violations = runRule(rule, `const X = <input type="image" alt="Submit" />;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("ignores non-img elements", () => {
      const violations = runRule(rule, `<div><p>no images here</p></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("suggests a file-name-derived subject in the suggestion", () => {
      const violations = runRule(rule, `<img src="/assets/revenue-chart-2026.png">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.suggestion).toContain("revenue chart 2026");
    });

    it("suggestion is context-aware (mentions filename)", () => {
      const violations = runRule(rule, `<img src="logo.png">`, { filePath: "index.html" });
      expect(violations[0]?.message).toContain("logo.png");
    });
  });

  describe("rule metadata", () => {
    it("declares both wcag22:1.1.1 and wcag21:1.1.1", () => {
      expect(rule.satisfies).toContain("wcag22:1.1.1");
      expect(rule.satisfies).toContain("wcag21:1.1.1");
    });

    it("has a normativeQuote citing WCAG", () => {
      expect(rule.docs.normativeQuote).toBeDefined();
      expect(rule.docs.references[0]).toContain("WCAG22");
    });
  });
});
