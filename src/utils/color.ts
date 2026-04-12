/**
 * Color parsing and conversion utilities.
 *
 * Parses hex, rgb(), rgba(), hsl(), and named CSS colors into linear-rgb
 * values used by the contrast calculator. Returns `null` for unparseable
 * input — callers decide whether that's an error or a skip.
 */

export interface Rgb {
  readonly r: number; // 0–255
  readonly g: number; // 0–255
  readonly b: number; // 0–255
  readonly a: number; // 0–1
}

const HEX_RE_3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_RE_4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_RE_6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RE_8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_RE =
  /^rgba?\(\s*([+-]?\d*\.?\d+)\s*,?\s*([+-]?\d*\.?\d+)\s*,?\s*([+-]?\d*\.?\d+)\s*(?:[,/]\s*([+-]?\d*\.?\d+%?)\s*)?\)$/i;
const HSL_RE =
  /^hsla?\(\s*([+-]?\d*\.?\d+)(?:deg)?\s*,?\s*([+-]?\d*\.?\d+)%?\s*,?\s*([+-]?\d*\.?\d+)%?\s*(?:[,/]\s*([+-]?\d*\.?\d+%?)\s*)?\)$/i;

/**
 * Parses any CSS color string into Rgb with alpha. Returns null on failure.
 *
 * The top-level is a cascade of single-purpose parsers — named, hex,
 * rgb(), hsl(). Each returns null on miss so the dispatcher stays
 * flat and readable.
 */
export function parseColor(input: string): Rgb | null {
  const trimmed = input.trim().toLowerCase();
  return (
    parseNamedColor(trimmed) ??
    parseHex(trimmed) ??
    parseRgbFunctional(trimmed) ??
    parseHslFunctional(trimmed)
  );
}

function parseNamedColor(trimmed: string): Rgb | null {
  const named = NAMED_COLORS[trimmed];
  if (named) return named;
  if (trimmed === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

function parseHex(trimmed: string): Rgb | null {
  return parseHex8(trimmed) ?? parseHex6(trimmed) ?? parseHex4(trimmed) ?? parseHex3(trimmed);
}

function parseHex8(trimmed: string): Rgb | null {
  const m = HEX_RE_8.exec(trimmed);
  if (!m) return null;
  return {
    r: parseInt(m[1] ?? "00", 16),
    g: parseInt(m[2] ?? "00", 16),
    b: parseInt(m[3] ?? "00", 16),
    a: parseInt(m[4] ?? "ff", 16) / 255,
  };
}

function parseHex6(trimmed: string): Rgb | null {
  const m = HEX_RE_6.exec(trimmed);
  if (!m) return null;
  return {
    r: parseInt(m[1] ?? "00", 16),
    g: parseInt(m[2] ?? "00", 16),
    b: parseInt(m[3] ?? "00", 16),
    a: 1,
  };
}

function parseHex4(trimmed: string): Rgb | null {
  const m = HEX_RE_4.exec(trimmed);
  if (!m) return null;
  return {
    r: parseInt((m[1] ?? "0").repeat(2), 16),
    g: parseInt((m[2] ?? "0").repeat(2), 16),
    b: parseInt((m[3] ?? "0").repeat(2), 16),
    a: parseInt((m[4] ?? "f").repeat(2), 16) / 255,
  };
}

function parseHex3(trimmed: string): Rgb | null {
  const m = HEX_RE_3.exec(trimmed);
  if (!m) return null;
  return {
    r: parseInt((m[1] ?? "0").repeat(2), 16),
    g: parseInt((m[2] ?? "0").repeat(2), 16),
    b: parseInt((m[3] ?? "0").repeat(2), 16),
    a: 1,
  };
}

function parseRgbFunctional(trimmed: string): Rgb | null {
  const m = RGB_RE.exec(trimmed);
  if (!m) return null;
  return {
    r: clamp(0, 255, Number.parseFloat(m[1] ?? "0")),
    g: clamp(0, 255, Number.parseFloat(m[2] ?? "0")),
    b: clamp(0, 255, Number.parseFloat(m[3] ?? "0")),
    a: parseAlpha(m[4]),
  };
}

function parseHslFunctional(trimmed: string): Rgb | null {
  const m = HSL_RE.exec(trimmed);
  if (!m) return null;
  const h = Number.parseFloat(m[1] ?? "0");
  const s = Number.parseFloat(m[2] ?? "0") / 100;
  const l = Number.parseFloat(m[3] ?? "0") / 100;
  const rgb = hslToRgb(h, s, l);
  return { ...rgb, a: parseAlpha(m[4]) };
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    return clamp(0, 1, Number.parseFloat(trimmed.slice(0, -1)) / 100);
  }
  return clamp(0, 1, Number.parseFloat(trimmed));
}

function clamp(min: number, max: number, v: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const NAMED_COLORS: Readonly<Record<string, Rgb>> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  magenta: { r: 255, g: 0, b: 255, a: 1 },
};
