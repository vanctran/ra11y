import { describe, expect, test } from "bun:test";

import { bold, red } from "../../../src/utils/ansi.ts";
import { wrapText } from "../../../src/utils/wrap.ts";

describe("wrapText", () => {
  test("leaves a short line alone", () => {
    expect(wrapText("hello world", 80)).toBe("hello world");
  });

  test("wraps at word boundary", () => {
    const out = wrapText("one two three four five six seven eight nine ten", 20);
    for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(20);
  });

  test("preserves explicit newlines", () => {
    expect(wrapText("alpha\n\nbeta", 80)).toBe("alpha\n\nbeta");
  });

  test("splits an over-wide single token rather than dropping it", () => {
    const long = "x".repeat(50);
    const lines = wrapText(long, 20).split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(long);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });

  test("counts CJK as double-width", () => {
    // "中" is 2 cells; with width 4 and 3 chars we get 2 lines.
    const out = wrapText("中文字", 4);
    expect(out).toBe("中文\n字");
  });

  test("does not count ANSI escapes toward width", () => {
    const colored = `${red("error")} ${bold("code")}`;
    // Width of visible text is "error code" → 10. Fits in 20.
    expect(wrapText(colored, 20).includes("\n")).toBe(false);
  });

  test("clamps absurdly small width to MIN_WIDTH (4)", () => {
    const out = wrapText("alpha beta gamma delta", 1);
    // Each line has at least one token; MIN_WIDTH gives over-long
    // tokens their own line rather than crashing or infinite-looping.
    expect(out.split("\n").length).toBeGreaterThan(1);
  });
});
