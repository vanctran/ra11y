/**
 * Section 508 (2017 refresh) metadata.
 *
 * Source: https://www.access-board.gov/ict/
 * Status: current U.S. federal accessibility regulation for ICT.
 *
 * The 2017 refresh does not define its own success criteria — it
 * incorporates WCAG 2.0 Level A and AA by reference via E205.4
 * (Accessibility Standard) and Chapter 5 (Software) / Chapter 6
 * (Support Documentation and Services).
 *
 * ra11y models Section 508 as a thin wrapper: we list the chapters
 * users cite in VPATs and map each one to its WCAG equivalent via
 * `equivalentTo`. Rules satisfying WCAG 2.0/2.1 automatically cover
 * Section 508 via the criteria-registry's reciprocal closure — no
 * rule code knows about Section 508 at all.
 */

export const SECTION508_ID = "section508";
export const SECTION508_NAME = "Section 508 (2017 refresh)";
export const SECTION508_VERSION = "2017";
export const SECTION508_PUBLISHER = "U.S. Access Board";
export const SECTION508_URL = "https://www.access-board.gov/ict/";
export const SECTION508_LEVELS = ["base"] as const;
