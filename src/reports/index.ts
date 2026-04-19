/**
 * Reports layer barrel. Structured data generators that consume a
 * ScanResult + loaded standards and produce certification-grade
 * outputs: per-standard coverage, manual-review checklist, VPAT
 * 2.4 conformance table, and readiness scorecard.
 */

export type {
  CertificationScore,
  ManualReview,
  ManualReviewEntry,
  ManualStatus,
} from "./certification.ts";
export { buildCertificationScorecard, renderCertificationMarkdown } from "./certification.ts";
export type { ChecklistItem, ChecklistReport, ChecklistSection } from "./checklist.ts";
export { buildChecklist, renderChecklistMarkdown } from "./checklist.ts";
export type {
  ConformanceBlocker,
  ConformanceBlockerReason,
  ConformanceProfile,
  ConformanceStatement,
} from "./conformance.ts";
export { buildConformanceStatement, renderConformanceMarkdown } from "./conformance.ts";
export type {
  ConformanceSignature,
  ConformanceVerificationReason,
  ConformanceVerificationResult,
  SignatureInput,
} from "./conformance-signature.ts";
export {
  signConformanceBundle,
  signConformanceBundleAt,
  verifyConformanceBundle,
} from "./conformance-signature.ts";
export type { PerStandardCoverage } from "./coverage.ts";
export { buildCoverageReport, toEngineCoverageEntry } from "./coverage.ts";
export type {
  Conformance,
  VpatEntry,
  VpatReport,
  VpatStandardSection,
} from "./vpat.ts";
export { buildVpatReport, renderVpatMarkdown } from "./vpat.ts";
