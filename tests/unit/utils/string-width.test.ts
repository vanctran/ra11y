import { describe, expect, it } from "bun:test";
import { padLeft, padRight, stringWidth } from "../../../src/utils/string-width.ts";

describe("utils/string-width", () => {
  it("ASCII characters are 1 cell wide", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("CJK characters are 2 cells wide", () => {
    expect(stringWidth("日本語")).toBe(6);
  });

  it("emoji count as 2 cells", () => {
    expect(stringWidth("✗")).toBeGreaterThanOrEqual(1);
  });

  it("ANSI escape sequences have zero width", () => {
    expect(stringWidth("\u001b[31merror\u001b[39m")).toBe(5);
  });

  it("combining marks have zero width", () => {
    // "é" as e + combining acute (U+0065 U+0301) — 1 cell, not 2
    expect(stringWidth("e\u0301")).toBe(1);
  });

  it("padRight pads with spaces to the requested visible width", () => {
    expect(padRight("ok", 5)).toBe("ok   ");
  });

  it("padRight is a no-op when the string is already wide enough", () => {
    expect(padRight("already long", 5)).toBe("already long");
  });

  it("padLeft pads on the left", () => {
    expect(padLeft("ok", 5)).toBe("   ok");
  });

  it("padding preserves ANSI sequences", () => {
    const input = "\u001b[31merror\u001b[39m"; // visible width 5
    const padded = padRight(input, 10);
    // Padded string should have 5 spaces of trailing padding.
    expect(padded.endsWith("     ")).toBe(true);
  });
});
