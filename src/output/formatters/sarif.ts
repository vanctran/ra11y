/**
 * SARIF 2.1.0 formatter for GitHub code scanning integration.
 *
 * Emits a minimal, spec-compliant SARIF log that `github/codeql-action/upload-sarif`
 * can ingest. Every ra11y violation becomes one `result` with:
 *   - `ruleId` → the SARIF rule ID
 *   - `level` → error | warning | note (mapped from our Severity)
 *   - `message.text` → the violation's human message
 *   - `locations[0]` → physicalLocation pointing at file + line + column
 *   - `partialFingerprints` → a stable hash of (ruleId, location, message)
 *     so GitHub can deduplicate across runs
 *
 * Every loaded rule contributes one `tool.driver.rules` entry with its
 * docs metadata. GitHub surfaces these in the Code Scanning alert UI.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 */

import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult, Severity, Violation } from "../../types/violation.ts";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0.json";
const TOOL_NAME = "ra11y";
const TOOL_VERSION = "0.0.0";
const INFORMATION_URI = "https://github.com/vanctran/ra11y";

interface SarifLog {
  // biome-ignore lint/style/useNamingConvention: $schema is the literal SARIF 2.1.0 spec field name
  readonly $schema: string;
  readonly version: string;
  readonly runs: readonly SarifRun[];
}

interface SarifRun {
  readonly tool: { readonly driver: SarifDriver };
  readonly results: readonly SarifResult[];
}

interface SarifDriver {
  readonly name: string;
  readonly version: string;
  readonly informationUri: string;
  readonly rules: readonly SarifRule[];
}

interface SarifRule {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly fullDescription: { readonly text: string };
  readonly helpUri?: string;
  readonly defaultConfiguration: { readonly level: SarifLevel };
  readonly properties: {
    readonly tags: readonly string[];
    /**
     * Short human titles for the criterion IDs carried in `tags`,
     * aligned index-for-index with the criteria subset of `tags`
     * (every tag after the leading `"accessibility"` sentinel). Lets
     * GitHub code-scanning consumers and downstream SARIF readers
     * render "Multiple Ways" without a separate WCAG lookup.
     */
    readonly criteriaTitles?: readonly string[];
  };
}

interface SarifResult {
  readonly ruleId: string;
  readonly level: SarifLevel;
  readonly message: { readonly text: string };
  readonly locations: readonly SarifLocation[];
  /**
   * SARIF spec "relatedLocations" — each entry is a secondary location
   * carrying a `role` property. We use role `"origin"` on inherited
   * findings (Q2R2-INHERITED / ADR 0012) to point at the wrapper
   * definition the finding was synthesized from. Omitted on primary
   * findings.
   */
  readonly relatedLocations?: readonly SarifRelatedLocation[];
  readonly partialFingerprints: Readonly<Record<string, string>>;
  /**
   * SARIF `properties` is an open, untyped bag (spec-compliant). We surface
   * the Violation's `couldBeWrongBecause` codes here so SARIF consumers
   * (GitHub code scanning, ingesters) can render the escape-hatch hints
   * alongside the finding without a schema change. Informational only —
   * see docs/adr/0009-violation-could-be-wrong-because.md.
   *
   * We also surface `confidence` here (canonically `"inherited"` on
   * synthesized call-site findings) so SARIF consumers can group /
   * filter without the schema change relatedLocations already implies.
   */
  readonly properties?: {
    readonly couldBeWrongBecause?: readonly string[];
    readonly confidence?: string;
  };
}

interface SarifRelatedLocation {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string };
    readonly region: {
      readonly startLine: number;
      readonly startColumn?: number;
    };
  };
  readonly properties: { readonly role: string };
}

interface SarifLocation {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string };
    readonly region: {
      readonly startLine: number;
      readonly startColumn: number;
      readonly endLine?: number;
      readonly endColumn?: number;
    };
  };
}

type SarifLevel = "error" | "warning" | "note" | "none";

export const sarifFormatter = defineFormatter({
  id: "sarif",
  format(result: ScanResult, _report: ReportData): string {
    const rules = collectRules(result.violations);
    const results = result.violations.map(violationToSarifResult);

    const log: SarifLog = {
      // biome-ignore lint/style/useNamingConvention: $schema is the literal SARIF 2.1.0 spec field name
      $schema: SARIF_SCHEMA,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: TOOL_NAME,
              version: TOOL_VERSION,
              informationUri: INFORMATION_URI,
              rules,
            },
          },
          results,
        },
      ],
    };

    return `${JSON.stringify(log, null, 2)}\n`;
  },
});

/**
 * Builds the SARIF `tool.driver.rules` array. We emit one entry per
 * distinct ruleId that actually fired in this scan — omitting rules
 * with zero findings keeps the log compact and focused, which is
 * what GitHub's code-scanning UI prefers.
 */
function collectRules(violations: readonly Violation[]): SarifRule[] {
  const byRuleId = new Map<string, Violation>();
  for (const v of violations) {
    if (!byRuleId.has(v.ruleId)) byRuleId.set(v.ruleId, v);
  }
  const rules: SarifRule[] = [];
  for (const [ruleId, sample] of byRuleId) {
    rules.push({
      id: ruleId,
      name: ruleId,
      shortDescription: { text: ruleIdToShortDescription(ruleId) },
      fullDescription: { text: sample.message },
      defaultConfiguration: { level: severityToLevel(sample.severity) },
      properties: {
        tags: ["accessibility", ...sample.criteria],
        // Aligned index-for-index with the criteria subset of `tags`
        // (i.e. tags[1..]). Omitted when the sample Violation didn't
        // carry titles — SARIF readers that rely on it can defer to
        // the criterion IDs in tags.
        ...(sample.criteriaTitles !== undefined && {
          criteriaTitles: [...sample.criteriaTitles],
        }),
      },
    });
  }
  rules.sort((a, b) => (a.id < b.id ? -1 : 1));
  return rules;
}

function ruleIdToShortDescription(ruleId: string): string {
  // "media/alt-text-missing" → "media alt text missing"
  return ruleId.replace(/[/_-]/g, " ");
}

function violationToSarifResult(violation: Violation): SarifResult {
  return {
    ruleId: violation.ruleId,
    level: severityToLevel(violation.severity),
    message: { text: violation.message },
    locations: [buildPrimaryLocation(violation)],
    partialFingerprints: {
      // Reuse the Violation's stable findingId — GitHub code scanning
      // uses this to deduplicate the same violation across runs. The
      // findingId is line-number-drift resilient by design (hashes the
      // ±3-line source-context window, not the line number itself), so
      // an unrelated edit above the violation won't invalidate
      // GitHub's dedup key.
      primary: violation.findingId,
      // Secondary key groups findings that share a rule + AST shape
      // across files (docs/adr/0008-violation-group-key.md). GitHub
      // uses secondary fingerprints as a fallback when `primary`
      // drifts, which matches the polarity here — groupKey is stable
      // across files for the same kind of problem.
      groupKey: violation.groupKey,
    },
    // Surface the Violation's `couldBeWrongBecause` reason codes and
    // `confidence` in SARIF's open `properties` bag. Omit the whole
    // object when there is nothing to carry — per CLAUDE.md §1
    // "Ambiguous field shapes are dishonest," a present-but-empty
    // properties object would be indistinguishable from "emitted
    // codes" vs "rule stayed silent." See ADR 0009 + ADR 0012.
    ...buildSarifProperties(violation),
    // Inherited findings (Q2R2-INHERITED) carry a pointer back to the
    // wrapper-definition location that originated the finding. SARIF
    // `relatedLocations` with `properties.role = "origin"` is the
    // canonical way to express "the real site lives here." See ADR
    // 0012.
    ...buildSarifRelatedLocations(violation),
  };
}

function buildPrimaryLocation(violation: Violation): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri: violation.location.filePath },
      region: {
        startLine: violation.location.line,
        startColumn: violation.location.column,
        ...(violation.location.endLine !== undefined && { endLine: violation.location.endLine }),
        ...(violation.location.endColumn !== undefined && {
          endColumn: violation.location.endColumn,
        }),
      },
    },
  };
}

function buildSarifRelatedLocations(
  violation: Violation,
): { readonly relatedLocations: readonly SarifRelatedLocation[] } | Record<string, never> {
  if (violation.sourceOfFinding === undefined) return {};
  const { filePath, line, column } = violation.sourceOfFinding;
  return {
    relatedLocations: [
      {
        physicalLocation: {
          artifactLocation: { uri: filePath },
          region: {
            startLine: line,
            ...(column !== undefined && { startColumn: column }),
          },
        },
        properties: { role: "origin" },
      },
    ],
  };
}

function buildSarifProperties(
  violation: Violation,
): { readonly properties: NonNullable<SarifResult["properties"]> } | Record<string, never> {
  const hasCodes =
    violation.couldBeWrongBecause !== undefined && violation.couldBeWrongBecause.length > 0;
  const confidence = violation.confidence;
  if (!hasCodes && confidence === undefined) return {};
  return {
    properties: {
      ...(hasCodes && { couldBeWrongBecause: [...(violation.couldBeWrongBecause ?? [])] }),
      ...(confidence !== undefined && { confidence }),
    },
  };
}

function severityToLevel(severity: Severity): SarifLevel {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "note";
}
