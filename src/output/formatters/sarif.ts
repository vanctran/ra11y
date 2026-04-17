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
  readonly partialFingerprints: Readonly<Record<string, string>>;
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
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: violation.location.filePath },
          region: {
            startLine: violation.location.line,
            startColumn: violation.location.column,
            ...(violation.location.endLine !== undefined && {
              endLine: violation.location.endLine,
            }),
            ...(violation.location.endColumn !== undefined && {
              endColumn: violation.location.endColumn,
            }),
          },
        },
      },
    ],
    partialFingerprints: {
      // Reuse the Violation's stable findingId — GitHub code scanning
      // uses this to deduplicate the same violation across runs. The
      // findingId is line-number-drift resilient by design (hashes the
      // ±3-line source-context window, not the line number itself), so
      // an unrelated edit above the violation won't invalidate
      // GitHub's dedup key.
      primary: violation.findingId,
    },
  };
}

function severityToLevel(severity: Severity): SarifLevel {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "note";
}
