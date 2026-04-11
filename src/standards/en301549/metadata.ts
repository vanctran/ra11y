/**
 * EN 301 549 v3.2.1 metadata.
 *
 * Source: https://www.etsi.org/deliver/etsi_en/301500_301599/301549/
 * Status: current European harmonized accessibility standard for ICT
 * products and services procured under Directive (EU) 2016/2102.
 *
 * Clause 9 (Web) incorporates WCAG 2.1 Level A and AA by reference.
 * ra11y models EN 301 549 as a thin wrapper over WCAG 2.1 A+AA,
 * with each criterion's `equivalentTo` pointing at its WCAG 2.2
 * counterpart (chained through 2.1 by the reciprocal closure).
 */

export const EN301549_ID = "en301549";
export const EN301549_NAME = "EN 301 549";
export const EN301549_VERSION = "v3.2.1";
export const EN301549_PUBLISHER = "ETSI";
export const EN301549_URL = "https://www.etsi.org/deliver/etsi_en/301500_301599/301549/";
export const EN301549_LEVELS = ["base"] as const;
