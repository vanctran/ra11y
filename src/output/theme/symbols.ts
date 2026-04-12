/**
 * Unicode symbols and glyphs for the terminal formatter.
 *
 * Severity is always conveyed by both color AND a leading glyph so
 * color-blind users and `--no-color` output stay unambiguous. Box-drawing
 * characters are used only in the decorated terminal mode; `--format
 * plain` and screen-reader modes omit them entirely.
 */

export const GLYPHS = {
  error: "✗",
  warning: "⚠",
  note: "✎",
  ok: "✓",
  bullet: "•",
} as const;

/** Box-drawing set used by the default terminal formatter. */
export const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
} as const;

/** Progress bar blocks used by coverage summaries. */
export const PROGRESS = {
  full: "█",
  empty: "░",
} as const;
