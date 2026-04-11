/**
 * WCAG contrast-ratio calculator.
 *
 * Implements the formula from WCAG 2.x section 1.4.3:
 *
 *   L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 *
 * where R, G, B are the sRGB-to-linear converted channel values. The
 * contrast ratio is then (L1 + 0.05) / (L2 + 0.05) where L1 is the
 * brighter of the two luminances.
 *
 * Normal text requires ≥ 4.5:1 (AA) / 7:1 (AAA).
 * Large text (≥ 18pt regular or ≥ 14pt bold) requires 3:1 / 4.5:1.
 */

import type { Rgb } from "./color.ts";

/** Linearizes an sRGB channel value in the range 0–255. */
function srgbToLinear(channel: number): number {
  const v = channel / 255;
  if (v <= 0.03928) return v / 12.92;
  return ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG. Input channels are 0–255. */
export function luminance(color: Rgb): number {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colors per WCAG 1.4.3.
 * Returns a number in [1, 21]. Symmetric: contrast(a, b) === contrast(b, a).
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 1.4.3 AA minimum for normal text (4.5:1). */
export const WCAG_AA_MIN_NORMAL = 4.5;
/** WCAG 1.4.3 AA minimum for large text (3:1). */
export const WCAG_AA_MIN_LARGE = 3;
/** WCAG 1.4.6 AAA minimum for normal text (7:1). */
export const WCAG_AAA_MIN_NORMAL = 7;
/** WCAG 1.4.6 AAA minimum for large text (4.5:1). */
export const WCAG_AAA_MIN_LARGE = 4.5;
/** WCAG 1.4.11 non-text contrast minimum (3:1). */
export const WCAG_AA_MIN_NON_TEXT = 3;

/** Returns true if the ratio meets WCAG 1.4.3 AA for the given text size. */
export function meetsWcagAa(ratio: number, large: boolean): boolean {
  return ratio >= (large ? WCAG_AA_MIN_LARGE : WCAG_AA_MIN_NORMAL);
}
