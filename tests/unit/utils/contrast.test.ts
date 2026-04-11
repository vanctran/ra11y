import { describe, expect, it } from "bun:test";
import { parseColor } from "../../../src/utils/color.ts";
import { contrast, luminance, meetsWcagAa } from "../../../src/utils/contrast.ts";

describe("utils/contrast", () => {
  describe("luminance", () => {
    it("black has luminance 0", () => {
      expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    });

    it("white has luminance 1", () => {
      expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBe(1);
    });
  });

  describe("contrast", () => {
    it("returns 21 for black on white", () => {
      const black = parseColor("#000000")!;
      const white = parseColor("#ffffff")!;
      expect(Math.round(contrast(black, white))).toBe(21);
    });

    it("is symmetric", () => {
      const a = parseColor("#336699")!;
      const b = parseColor("#fefefe")!;
      expect(contrast(a, b)).toBe(contrast(b, a));
    });

    it("returns 1 when both colors are identical", () => {
      const c = parseColor("#777777")!;
      expect(contrast(c, c)).toBe(1);
    });

    it("matches known WCAG test vectors", () => {
      // #595959 on white is ~7.0:1 — a common AAA threshold check.
      const fg = parseColor("#595959")!;
      const bg = parseColor("#ffffff")!;
      const ratio = contrast(fg, bg);
      expect(ratio).toBeGreaterThan(6.9);
      expect(ratio).toBeLessThan(7.1);
    });

    it("correctly reports a failing pair", () => {
      // #aaaaaa on white is ~2.3:1 — fails normal and large.
      const fg = parseColor("#aaaaaa")!;
      const bg = parseColor("#ffffff")!;
      const ratio = contrast(fg, bg);
      expect(meetsWcagAa(ratio, false)).toBe(false);
      expect(meetsWcagAa(ratio, true)).toBe(false);
    });
  });

  describe("meetsWcagAa", () => {
    it("4.5 exactly passes normal text", () => {
      expect(meetsWcagAa(4.5, false)).toBe(true);
    });

    it("4.49 fails normal text", () => {
      expect(meetsWcagAa(4.49, false)).toBe(false);
    });

    it("3.0 exactly passes large text", () => {
      expect(meetsWcagAa(3.0, true)).toBe(true);
    });

    it("2.99 fails large text", () => {
      expect(meetsWcagAa(2.99, true)).toBe(false);
    });
  });
});

describe("utils/color parseColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it("parses 3-digit hex as expanded", () => {
    expect(parseColor("#f80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it("parses 8-digit hex with alpha", () => {
    expect(parseColor("#ff880080")).toEqual({ r: 255, g: 136, b: 0, a: 128 / 255 });
  });

  it("parses rgb()", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it("parses rgba() with decimal alpha", () => {
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("parses hsl()", () => {
    const c = parseColor("hsl(0, 100%, 50%)");
    expect(c?.r).toBe(255);
    expect(c?.g).toBe(0);
    expect(c?.b).toBe(0);
  });

  it("parses named colors", () => {
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("parses transparent as zero alpha", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null on garbage", () => {
    expect(parseColor("not a color")).toBeNull();
    expect(parseColor("#xyz")).toBeNull();
  });
});
