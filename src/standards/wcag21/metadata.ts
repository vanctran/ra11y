/**
 * WCAG 2.1 metadata.
 *
 * Source: https://www.w3.org/TR/WCAG21/
 * Status: W3C Recommendation (2018-06-05, update 2023-09-21).
 *
 * WCAG 2.1 is still the reference standard for many legal frameworks
 * (ADA case law, EN 301 549 v3.2.1, Section 508 2017 refresh) even
 * though 2.2 is newer. ra11y ships both so users can run against
 * whichever their compliance framework cites.
 */

export const WCAG21_ID = "wcag21";
export const WCAG21_NAME = "WCAG 2.1";
export const WCAG21_VERSION = "2.1";
export const WCAG21_PUBLISHER = "W3C";
export const WCAG21_URL = "https://www.w3.org/TR/WCAG21/";
export const WCAG21_LEVELS = ["A", "AA", "AAA"] as const;

/** Deep-link URL for a given SC. Same anchor convention as WCAG 2.2. */
export function wcag21Url(slug: string): string {
  return `${WCAG21_URL}#${slug}`;
}
