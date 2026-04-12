import { describe, expect, it } from "bun:test";
import { parseInlineDisables } from "../../../src/config/inline-disables.ts";

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
});
