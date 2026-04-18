/**
 * Barrel export for ra11y's shared type system.
 *
 * All types under `src/` are re-exported from this single module so that
 * intra-repo imports don't fan out across dozens of deep paths. This is
 * the single source of truth — if you want to change a type, change it
 * here (or in the file it lives in) and the whole codebase follows.
 */

export type {
  Ast,
  BaseNode,
  CssAtRule,
  CssComment,
  CssDeclaration,
  CssNode,
  CssRule,
  CssStylesheet,
  HtmlAttribute,
  HtmlComment,
  HtmlDoctype,
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  HtmlText,
  JsxAttribute,
  JsxAttributeValue,
  JsxElement,
  JsxExpression,
  JsxNode,
  JsxText,
  ParseError,
  SourcePosition,
  SourceRange,
  TsxModule,
} from "./ast.ts";
export type {
  Config,
  ConfigOverride,
  LoadedConfig,
  ProjectConfig,
  RuleSetting,
} from "./config.ts";
export type {
  AttestationRecord,
  CriterionEvidence,
  EvidenceLedger,
  EvidenceSource,
  EvidenceStatus,
} from "./evidence.ts";
export type {
  CandidateFinder,
  CandidateFinderDocs,
  CandidateFinderScope,
  ProjectCandidateContext,
  ProjectFile,
  ReviewCandidate,
} from "./review.ts";
export type {
  AppliesTo,
  EmittedViolation,
  FileContext,
  Language,
  ProjectContext,
  Rule,
  RuleContext,
  RuleDocs,
  RuleScope,
} from "./rule.ts";
export type {
  Automatability,
  Criterion,
  Standard,
} from "./standard.ts";
export type {
  CoverageEntry,
  Fix,
  Location,
  ReportData,
  ScanResult,
  Severity,
  Violation,
} from "./violation.ts";
