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

  describe("JSDoc @ra11y-intentional tag", () => {
    // Guards that a JSDoc tag WITH a reason scopes a wildcard disable
    // over the decorated declaration's brace-balanced body. Without
    // this, Storybook-style bad-example components would still surface
    // their teaching violations at scan time.
    it("honors `@ra11y-intentional <reason>` on a function declaration and scopes disables to its body", () => {
      const src = [
        "/** @ra11y-intentional demo of missing alt attribute */",
        "export function BadImage() {",
        '  return <img src="/logo.png" />;',
        "}",
        'const ok = <img src="/logo.png" alt="logo" />;',
      ].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      // Lines 2-4 inclusive are the declaration body — they must all
      // carry a `*` disable so rule violations there are suppressed.
      expect(disableMap.get(2)?.has("*")).toBe(true);
      expect(disableMap.get(3)?.has("*")).toBe(true);
      expect(disableMap.get(4)?.has("*")).toBe(true);
      // Line 5 (outside the tagged declaration) must NOT carry a
      // scoped disable — that's the whole point of the subtree scope.
      expect(disableMap.get(5)?.has("*")).toBeFalsy();
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toMatchObject({
        kind: "disable",
        line: 1,
        ruleIds: ["*"],
        reason: "demo of missing alt attribute",
        tag: "ra11y-intentional",
      });
    });

    // Guards that a bare tag is NOT honored — no disableMap entries
    // are created — but is still recorded as a declaration so the
    // suppression/no-reason finder can surface a review candidate.
    // The reason slot is load-bearing per AI-first doctrine.
    it("does NOT honor a bare `@ra11y-intentional` tag but still records it", () => {
      const src = [
        "/** @ra11y-intentional */",
        "export function Bare() {",
        "  return <div />;",
        "}",
      ].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      expect(disableMap.size).toBe(0);
      expect(declarations).toHaveLength(1);
      expect(declarations[0]?.reason).toBeUndefined();
      expect("reason" in (declarations[0] ?? {})).toBe(false);
      expect(declarations[0]?.tag).toBe("ra11y-intentional");
    });

    // Guards that arrow/variable declarations work, not just function
    // statements. Storybook stories often use `export const Story =
    // () => <Bad />` form.
    it("honors the tag on a const arrow declaration", () => {
      const src = [
        "/** @ra11y-intentional story of contrast violation */",
        "export const BadStory = () => {",
        '  return <div style={{ color: "#ccc", background: "#fff" }}>x</div>;',
        "};",
      ].join("\n");
      const { disableMap } = parseInlineDisablesDetailed(src);
      expect(disableMap.get(2)?.has("*")).toBe(true);
      expect(disableMap.get(3)?.has("*")).toBe(true);
      expect(disableMap.get(4)?.has("*")).toBe(true);
    });

    // Guards scope isolation when the same file has multiple tagged
    // declarations — each tag must scope only its own body, not the
    // whole file.
    it("scopes each decorated declaration independently when multiple are present", () => {
      const src = [
        "/** @ra11y-intentional first demo */",
        "export function First() {",
        "  return <img src='x' />;",
        "}",
        "",
        "export function Plain() {",
        "  return <img src='y' />;",
        "}",
        "",
        "/** @ra11y-intentional second demo */",
        "export function Second() {",
        "  return <img src='z' />;",
        "}",
      ].join("\n");
      const { disableMap } = parseInlineDisablesDetailed(src);
      // First() body lines 2–4 suppressed.
      expect(disableMap.get(2)?.has("*")).toBe(true);
      expect(disableMap.get(4)?.has("*")).toBe(true);
      // Plain() body lines 6–8 must NOT be suppressed — no tag.
      expect(disableMap.get(6)?.has("*")).toBeFalsy();
      expect(disableMap.get(7)?.has("*")).toBeFalsy();
      expect(disableMap.get(8)?.has("*")).toBeFalsy();
      // Second() body lines 11–13 suppressed.
      expect(disableMap.get(11)?.has("*")).toBe(true);
      expect(disableMap.get(13)?.has("*")).toBe(true);
    });

    // Guards the mixed-tag JSDoc case: the @ra11y-intentional reason
    // must NOT swallow text from an unrelated tag that follows it.
    it("stops reason capture at the next JSDoc tag", () => {
      const src = [
        "/**",
        " * @ra11y-intentional contrast demo",
        " * @see https://example.com/style-guide",
        " */",
        "export function Demo() {",
        "  return <div />;",
        "}",
      ].join("\n");
      const { declarations } = parseInlineDisablesDetailed(src);
      expect(declarations[0]?.reason).toBe("contrast demo");
    });

    // Guards that `@ra11y-intentional` written inside a string literal
    // is not picked up by the parser. The parser must match only
    // within JSDoc block comments.
    it("does NOT match `@ra11y-intentional` inside a string literal", () => {
      const src = [
        'const docs = "@ra11y-intentional is a JSDoc tag";',
        "export function Plain() {",
        "  return <div />;",
        "}",
      ].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      expect(disableMap.size).toBe(0);
      expect(declarations).toHaveLength(0);
    });

    // Guards that a tag applied to a non-component declaration — a
    // plain variable, for example — is still honored. Detection is
    // purely syntactic; we do not attempt a "is this really a React
    // component?" heuristic.
    it("honors the tag on a non-component variable declaration", () => {
      const src = [
        "/** @ra11y-intentional legacy config retained verbatim */",
        "export const legacy = { color: '#ccc', background: '#fff' };",
        "const other = 1;",
      ].join("\n");
      const { disableMap } = parseInlineDisablesDetailed(src);
      expect(disableMap.get(2)?.has("*")).toBe(true);
      expect(disableMap.get(3)?.has("*")).toBeFalsy();
    });

    // Guards that `@ra11y-intentionally` (a longer word starting with
    // the tag) does NOT match — the tag must end at a word boundary.
    it("does NOT match an extended word like `@ra11y-intentionally`", () => {
      const src = [
        "/** @ra11y-intentionally misleading name */",
        "export function X() { return <div />; }",
      ].join("\n");
      const { disableMap, declarations } = parseInlineDisablesDetailed(src);
      expect(disableMap.size).toBe(0);
      expect(declarations).toHaveLength(0);
    });
  });
});
