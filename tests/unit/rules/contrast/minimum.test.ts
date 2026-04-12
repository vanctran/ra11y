import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/contrast/minimum.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule contrast/minimum", () => {
  describe("fires when", () => {
    it("normal text has a ratio below 4.5:1 (light gray on white)", () => {
      const v = runRule(rule, `.muted { color: #aaaaaa; background-color: #ffffff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("contrast ratio");
      expect(v[0]?.message).toContain("4.5:1");
    });

    it("hex3 ratio below threshold", () => {
      const v = runRule(rule, `.tip { color: #aaa; background: #fff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
    });

    it("rgb() ratio below threshold", () => {
      const v = runRule(
        rule,
        `.soft { color: rgb(170, 170, 170); background-color: rgb(255,255,255); }`,
        { filePath: "styles.css" },
      );
      expect(v).toHaveLength(1);
    });

    it("named colors fail (e.g., gray on white)", () => {
      const v = runRule(rule, `.sys { color: gray; background-color: white; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
    });

    it("large-text rule applies when font-size >= 18pt (3:1 threshold)", () => {
      // #9c9c9c on white is ~2.85:1 — fails even large text.
      const v = runRule(rule, `.big { color: #9c9c9c; background: #fff; font-size: 24px; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("3");
    });

    it("message quotes the selector for context", () => {
      const v = runRule(rule, `.card .caption { color: #b0b0b0; background-color: #ffffff; }`, {
        filePath: "styles.css",
      });
      expect(v[0]?.message).toContain(".card .caption");
    });
  });

  describe("does NOT fire when", () => {
    it("black on white (21:1)", () => {
      const v = runRule(rule, `.x { color: #000; background: #fff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("ratio exactly meets 4.5 for normal text", () => {
      // #717171 on white is ~4.59:1
      const v = runRule(rule, `.x { color: #717171; background: #ffffff; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("large text at 3:1 with font-size 24px", () => {
      // #949494 on white is ~3.04:1 — passes large-text threshold.
      const v = runRule(rule, `.big { color: #949494; background: #fff; font-size: 24px; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("large text at 14pt bold with font-weight: 700", () => {
      const v = runRule(
        rule,
        `.big-bold { color: #949494; background: #fff; font-size: 14pt; font-weight: 700; }`,
        { filePath: "styles.css" },
      );
      expect(v).toHaveLength(0);
    });

    it("no color declaration", () => {
      const v = runRule(rule, `.x { background: #fff; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("no background declaration", () => {
      const v = runRule(rule, `.x { color: #aaa; }`, { filePath: "styles.css" });
      expect(v).toHaveLength(0);
    });

    it("transparent background — can't compute contrast without inheritance", () => {
      const v = runRule(rule, `.x { color: #aaa; background-color: transparent; }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });

    it("shorthand background extracts the color token", () => {
      const v = runRule(rule, `.hero { color: #000; background: #fff url('bg.png') no-repeat; }`, {
        filePath: "styles.css",
      });
      // #000 on white passes, no violation.
      expect(v).toHaveLength(0);
    });

    it("unparseable color values are silently skipped", () => {
      const v = runRule(rule, `.x { color: var(--fg); background: var(--bg); }`, {
        filePath: "styles.css",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("inside at-rules", () => {
    it("fires on rules nested in @media", () => {
      const src = `@media (max-width: 600px) { .x { color: #aaa; background: #fff; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });

    it("fires on rules nested in @supports", () => {
      const src = `@supports (display: grid) { .x { color: #aaa; background: #fff; } }`;
      const v = runRule(rule, src, { filePath: "styles.css" });
      expect(v).toHaveLength(1);
    });
  });

  describe("suggestion quality", () => {
    it("includes the failing ratio and target threshold in the suggestion", () => {
      const v = runRule(rule, `.x { color: #aaa; background: #fff; }`, {
        filePath: "styles.css",
      });
      expect(v[0]?.suggestion).toContain("WebAIM");
      expect(v[0]?.suggestion).toContain("4.5");
    });
  });

  it("cites wcag22:1.4.3 and wcag21:1.4.3", () => {
    expect(rule.satisfies).toContain("wcag22:1.4.3");
    expect(rule.satisfies).toContain("wcag21:1.4.3");
  });
});
