/**
 * Terminal-aware string width computation.
 *
 * The default `string.length` counts UTF-16 code units, which is wrong for:
 *   - Emoji and CJK characters (double-width glyphs)
 *   - Combining marks (zero-width)
 *   - Zero-width joiners
 *   - ANSI escape sequences (zero-width)
 *
 * This module returns the visible cell width as rendered in a monospace
 * terminal, which is what the formatter needs to align tables.
 *
 * Zero-dep, covers the common cases. Not perfect — we don't handle every
 * Unicode edge, but it's enough for rule IDs, file paths, WCAG SC labels,
 * and violation messages, which is all we render.
 */

import { stripAnsi } from "./ansi.ts";

// Control characters and zero-width code points.
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL + C1 controls
  [0x0300, 0x036f], // Combining diacriticals
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x2028, 0x202e],
  [0xfe00, 0xfe0f], // Variation selectors
  [0xfeff, 0xfeff], // BOM
];

// Ranges that render double-width in a monospace terminal.
const DOUBLE_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f9ff], // Emoji
  [0x20000, 0x2fffd], // CJK Extension B-F
  [0x30000, 0x3fffd],
];

function inRange(code: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (code >= start && code <= end) return true;
  }
  return false;
}

/** Visible cell width of a string in a monospace terminal. */
export function stringWidth(input: string): number {
  const clean = stripAnsi(input);
  let width = 0;
  for (const ch of clean) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (inRange(code, ZERO_WIDTH_RANGES)) continue;
    if (inRange(code, DOUBLE_WIDTH_RANGES)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/** Pads `str` on the right with spaces so its visible width is at least `width`. */
export function padRight(str: string, width: number): string {
  const w = stringWidth(str);
  if (w >= width) return str;
  return str + " ".repeat(width - w);
}

/** Pads `str` on the left with spaces so its visible width is at least `width`. */
export function padLeft(str: string, width: number): string {
  const w = stringWidth(str);
  if (w >= width) return str;
  return " ".repeat(width - w) + str;
}
