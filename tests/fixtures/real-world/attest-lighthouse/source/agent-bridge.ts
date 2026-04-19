/**
 * agent-bridge.ts — illustrative pattern for bridging Lighthouse
 * accessibility audit results into the ra11y attestation ledger.
 *
 * This file is NOT executed by the ra11y scanner.
 * It is the executable proof that the pattern compiles cleanly and
 * forms the canonical reference for the bridging-runtime-a11y doc.
 *
 * Pattern overview:
 *   1. Read the Lighthouse JSON report your CI produced.
 *   2. Walk `categories.accessibility.auditRefs` to get audit IDs.
 *   3. For each audit, look at `audits[id].score`:
 *      - score === 0  → verdict "fail"
 *      - score === 1  → verdict "pass"
 *      - score === null → skip (informational, no binary pass/fail)
 *   4. Map audit IDs to WCAG criteria using the auditRef tags or a
 *      static lookup table.
 *   5. Call `attest` with the appropriate payload.
 *
 * See docs/kb/patterns/bridging-runtime-a11y.md for the full guide.
 */

// ---------------------------------------------------------------------------
// Minimal type stubs matching the Lighthouse JSON report shape.
// No Lighthouse import — the agent reads the report file directly.
// ---------------------------------------------------------------------------

interface LighthouseNode {
  readonly type: "node";
  readonly snippet: string;
  readonly nodeLabel?: string;
  readonly selector?: string;
}

interface LighthouseAuditItem {
  readonly node?: LighthouseNode;
  readonly contrastRatio?: number;
  readonly thresholdAA?: number;
}

interface LighthouseAuditDetails {
  readonly type: "table" | "list" | "opportunity";
  readonly items: readonly LighthouseAuditItem[];
}

interface LighthouseAudit {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly score: number | null;
  readonly scoreDisplayMode: "binary" | "numeric" | "informative" | "error" | "notApplicable";
  readonly details?: LighthouseAuditDetails;
}

interface LighthouseAuditRef {
  readonly id: string;
  readonly weight: number;
  readonly group?: string;
}

interface LighthouseCategory {
  readonly id: string;
  readonly title: string;
  readonly score: number | null;
  readonly auditRefs: readonly LighthouseAuditRef[];
}

interface LighthouseReport {
  readonly lighthouseVersion: string;
  readonly requestedUrl: string;
  readonly fetchTime: string;
  readonly categories: Readonly<Record<string, LighthouseCategory>>;
  readonly audits: Readonly<Record<string, LighthouseAudit>>;
}

// ---------------------------------------------------------------------------
// Mapping from Lighthouse audit ID to ra11y/WCAG criterion ID.
//
// Lighthouse audit IDs map 1:1 to axe-core rule IDs for most checks.
// The criterion IDs are derived from Lighthouse's WCAG tags in the
// full report, or from the published mapping at:
//   https://web.dev/lighthouse-accessibility/
// ---------------------------------------------------------------------------

const LIGHTHOUSE_AUDIT_TO_CRITERION: Readonly<Record<string, string>> = {
  "color-contrast": "wcag22:1.4.3",
  "color-contrast-enhanced": "wcag22:1.4.6",
  "image-alt": "wcag22:1.1.1",
  label: "wcag22:4.1.2",
  "link-name": "wcag22:2.4.4",
  "button-name": "wcag22:4.1.2",
  "document-title": "wcag22:2.4.2",
  "html-has-lang": "wcag22:3.1.1",
  "html-lang-valid": "wcag22:3.1.1",
  "frame-title": "wcag22:4.1.2",
  "meta-refresh": "wcag22:2.2.1",
  "video-caption": "wcag22:1.2.2",
  "audio-caption": "wcag22:1.2.4",
  "aria-allowed-attr": "wcag22:4.1.2",
  "aria-required-attr": "wcag22:4.1.2",
  "aria-valid-attr": "wcag22:4.1.2",
  "aria-valid-attr-value": "wcag22:4.1.2",
  "focus-traps": "wcag22:2.1.2",
  "logical-tab-order": "wcag22:2.4.3",
  "managed-focus": "wcag22:3.2.2",
  "offscreen-content-hidden": "wcag22:1.3.2",
  "use-landmarks": "wcag22:1.3.6",
};

// ---------------------------------------------------------------------------
// Bridge: accessibility category audits → attest payloads
// ---------------------------------------------------------------------------

interface AttestPayload {
  readonly criterionId: string;
  readonly verdict: "pass" | "fail";
  readonly reason: string;
  readonly by: string;
  readonly attestedAt: string;
}

/**
 * Maps one binary Lighthouse audit to an attest payload. Returns null
 * when the audit should be skipped (non-binary, null score, or no
 * criterion mapping).
 */
function bridgeAudit(
  auditId: string,
  audit: LighthouseAudit,
  report: LighthouseReport,
  by: string,
): AttestPayload | null {
  if (audit.scoreDisplayMode !== "binary") return null;
  if (audit.score === null) return null;
  const criterionId = LIGHTHOUSE_AUDIT_TO_CRITERION[auditId];
  if (criterionId === undefined) return null;

  const verdict: "pass" | "fail" = audit.score === 1 ? "pass" : "fail";
  const failDetails =
    verdict === "fail" && audit.details !== undefined
      ? ` ${audit.details.items.length} failing node(s).`
      : "";
  return {
    criterionId,
    verdict,
    reason: `Lighthouse ${report.lighthouseVersion} (${report.fetchTime}): audit "${auditId}" ${verdict === "pass" ? "passed" : "failed"}.${failDetails} ${audit.title}`,
    by,
    attestedAt: report.fetchTime,
  };
}

/**
 * Builds the `attest` call parameters from the Lighthouse accessibility
 * category. The agent passes these to the MCP `attest` tool one at a time.
 *
 * Only binary audits (scoreDisplayMode === "binary") are bridged.
 * Informational audits (score === null) are skipped because they
 * carry no pass/fail verdict to assert.
 */
function bridgeAccessibilityCategory(report: LighthouseReport, by: string): AttestPayload[] {
  const a11yCategory = report.categories["accessibility"];
  if (a11yCategory === undefined) return [];

  const out: AttestPayload[] = [];
  for (const ref of a11yCategory.auditRefs) {
    const audit = report.audits[ref.id];
    if (audit === undefined) continue;
    const payload = bridgeAudit(ref.id, audit, report, by);
    if (payload !== null) out.push(payload);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point: produce the full list of attest calls for the agent.
// ---------------------------------------------------------------------------

/**
 * Given a Lighthouse report, returns every `attest` payload the agent
 * should dispatch for accessibility-category audits.
 *
 * Usage (agent pseudocode):
 *   const report = JSON.parse(readFile("lighthouse-report.json"));
 *   const payloads = buildAttestPayloads(report, "lighthouse+ci");
 *   for (const payload of payloads) {
 *     await mcp.call("attest", payload);
 *   }
 */
export function buildAttestPayloads(
  report: LighthouseReport,
  by = "lighthouse+ci",
): ReadonlyArray<AttestPayload> {
  return bridgeAccessibilityCategory(report, by);
}
