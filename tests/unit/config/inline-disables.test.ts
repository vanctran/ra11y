import { describe, expect, it } from "bun:test";
import {
  parseInlineDisables,
  parseInlineDisablesDetailed,
} from "../../../src/config/inline-disables.ts";

describe("parseInlineDisables", () => {
  describe("disable-next-line pragma", () => {
    it("suppresses the line immediately following a // comment", () => {
      const src = [
        "const a = 1;",
        "// ra11y-disable-next-line contrast/minimum",
        "const b = 2;",
      ].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(3)?.has("contrast/minimum")).toBe(true);
    });

    it("suppresses the next line for multiple rule IDs", () => {
      const src = [
        "// ra11y-disable-next-line contrast/minimum, link/descriptive-text",
        "const x = 1;",
      ].join("\n");
      const map = parseInlineDisables(src);
      const set = map.get(2);
      expect(set?.has("contrast/minimum")).toBe(true);
      expect(set?.has("link/descriptive-text")).toBe(true);
    });

    it("uses wildcard * when no rule IDs are listed", () => {
      const src = ["// ra11y-disable-next-line", "const x = 1;"].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("*")).toBe(true);
    });

    it("works with block comments /* ... */", () => {
      const src = ["/* ra11y-disable-next-line contrast/minimum */", "const x = 1;"].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("contrast/minimum")).toBe(true);
    });

    it("works with HTML comments <!-- ... -->", () => {
      const src = ["<!-- ra11y-disable-next-line contrast/minimum -->", "<p>x</p>"].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("contrast/minimum")).toBe(true);
    });

    it("works with JSX block comments {/* ... */}", () => {
      const src = ["{/* ra11y-disable-next-line contrast/minimum */}", "<div>x</div>"].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("contrast/minimum")).toBe(true);
    });
  });

  describe("disable/enable regions", () => {
    it("suppresses rules between disable and enable", () => {
      const src = [
        "// ra11y-disable contrast/minimum",
        "const a = 1;",
        "const b = 2;",
        "// ra11y-enable contrast/minimum",
        "const c = 3;",
      ].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("contrast/minimum")).toBe(true);
      expect(map.get(3)?.has("contrast/minimum")).toBe(true);
      expect(map.get(5)?.has("contrast/minimum")).toBeFalsy();
    });

    it("supports nested disable regions (innermost enable pops the top)", () => {
      const src = [
        "// ra11y-disable A",
        "line2",
        "// ra11y-disable B",
        "line4",
        "// ra11y-enable",
        "line6",
      ].join("\n");
      const map = parseInlineDisables(src);
      // After the inner disable: both A and B active on line 4.
      expect(map.get(4)?.has("A")).toBe(true);
      expect(map.get(4)?.has("B")).toBe(true);
      // After the enable on line 5: B is popped, A still active on 6.
      expect(map.get(6)?.has("A")).toBe(true);
      expect(map.get(6)?.has("B")).toBeFalsy();
    });

    it("wildcard disable covers every rule", () => {
      const src = ["// ra11y-disable", "line2", "// ra11y-enable", "line4"].join("\n");
      const map = parseInlineDisables(src);
      expect(map.get(2)?.has("*")).toBe(true);
      expect(map.get(4)?.has("*")).toBeFalsy();
    });
  });

  it("ignores non-ra11y comments", () => {
    const src = ["// eslint-disable-next-line no-console", "console.log('x');"].join("\n");
    const map = parseInlineDisables(src);
    expect(map.size).toBe(0);
  });

  it("returns an empty map for clean source", () => {
    const map = parseInlineDisables("const x = 1;\nconst y = 2;");
    expect(map.size).toBe(0);
  });

  it("handles comments with trailing reason text", () => {
    const src = [
      "// ra11y-disable-next-line contrast/minimum -- legacy, fix in #123",
      "const x = 1;",
    ].join("\n");
    const map = parseInlineDisables(src);
    expect(map.get(2)?.has("contrast/minimum")).toBe(true);
    // Make sure the reason text isn't parsed as a rule id
    expect(map.get(2)?.has("legacy,")).toBeFalsy();
    expect(map.get(2)?.has("fix")).toBeFalsy();
  });

  describe("parseInlineDisablesDetailed — reason capture", () => {
    it("captures reason text after a `:` separator", () => {
      const src = [
        "// ra11y-disable-next-line contrast/minimum: light text only on brand gradient",
        "const x = 1;",
      ].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      expect(disableMap.get(2)?.has("contrast/minimum")).toBe(true);
      expect(declarations).toHaveLength(1);
      expect(declarations[0]?.reason).toBe("light text only on brand gradient");
      expect(declarations[0]?.ruleIds).toEqual(["contrast/minimum"]);
    });

    it("captures reason text after a `--` separator", () => {
      const src = [
        "// ra11y-disable-next-line contrast/minimum -- legacy, fix in #123",
        "const x = 1;",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.reason).toBe("legacy, fix in #123");
    });

    it("does NOT treat the colon in a criterion ID as a reason separator", () => {
      const src = ["<!-- ra11y-disable-next-line wcag22:2.4.5 -->", "<p>x</p>"].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      expect(disableMap.get(2)?.has("wcag22:2.4.5")).toBe(true);
      expect(declarations[0]?.ruleIds).toEqual(["wcag22:2.4.5"]);
      expect(declarations[0]?.reason).toBeUndefined();
    });

    it("captures reason even when the rule list contains criterion IDs", () => {
      const src = [
        "// ra11y-disable-next-line wcag22:2.4.5, contrast/minimum: not applicable in VR mode",
        "<p>x</p>",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.ruleIds).toEqual(["wcag22:2.4.5", "contrast/minimum"]);
      expect(declarations[0]?.reason).toBe("not applicable in VR mode");
    });

    it("omits `reason` entirely when none is supplied", () => {
      const src = ["// ra11y-disable-next-line contrast/minimum", "const x = 1;"].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.reason).toBeUndefined();
      expect("reason" in (declarations[0] ?? {})).toBe(false);
    });

    it("strips JSX comment trailers from the captured reason", () => {
      const src = [
        "{/* ra11y-disable-next-line contrast/minimum: brand gradient, tracked in #432 */}",
        "const x = 1;",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.reason).toBe("brand gradient, tracked in #432");
    });

    it("strips HTML comment trailers from the captured reason", () => {
      const src = [
        "<!-- ra11y-disable-next-line contrast/minimum: dark-mode promo -->",
        "<p>x</p>",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.reason).toBe("dark-mode promo");
    });

    it("records `line`, `kind`, and `ruleIds` on every declaration", () => {
      const src = [
        "// ra11y-disable contrast/minimum: intentional",
        "const x = 1;",
        "// ra11y-enable contrast/minimum",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations).toHaveLength(2);
      expect(declarations[0]).toMatchObject({
        kind: "disable",
        line: 1,
        ruleIds: ["contrast/minimum"],
        reason: "intentional",
      });
      expect(declarations[1]).toMatchObject({
        kind: "enable",
        line: 3,
        ruleIds: ["contrast/minimum"],
      });
    });
  });
});
