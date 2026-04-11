/**
 * WCAG 2.2 metadata.
 *
 * Static facts about the Web Content Accessibility Guidelines 2.2:
 * publisher, version, level names, principle/guideline structure,
 * and the URL anchor template used to build `Criterion.url`.
 *
 * Source of truth: https://www.w3.org/TR/WCAG22/
 * Status: W3C Recommendation (2023-10-05), updated 2024-12-12,
 *         approved as ISO/IEC 40500:2025.
 */

export const WCAG22_ID = "wcag22";
export const WCAG22_NAME = "WCAG 2.2";
export const WCAG22_VERSION = "2.2";
export const WCAG22_PUBLISHER = "W3C";
export const WCAG22_URL = "https://www.w3.org/TR/WCAG22/";
export const WCAG22_LEVELS = ["A", "AA", "AAA"] as const;

/**
 * Builds the deep-link URL for a given SC. The anchor convention is the
 * criterion slug, lowercased with spaces replaced by hyphens.
 *
 *   1.4.3 Contrast (Minimum) → #contrast-minimum
 */
export function wcag22Url(slug: string): string {
  return `${WCAG22_URL}#${slug}`;
}

/** The four top-level WCAG principles. */
export const WCAG_PRINCIPLES = {
  perceivable: "1",
  operable: "2",
  understandable: "3",
  robust: "4",
} as const;
