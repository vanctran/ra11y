/**
 * agent-bridge.ts — illustrative pattern for bridging axe-core
 * runtime results into the ra11y attestation ledger.
 *
 * This file is NOT executed by the ra11y scanner.
 * It is the executable proof that the pattern compiles cleanly and
 * forms the canonical reference for the bridging-runtime-a11y doc.
 *
 * Pattern overview:
 *   1. Read the axe-core JSON output your CI produced.
 *   2. Map each axe rule ID to the WCAG criterion it covers.
 *   3. For violations, call `attest` with `verdict: "fail"` and the
 *      axe failure summary as the reason.
 *   4. For passes, call `attest` with `verdict: "pass"` and the
 *      axe confirmation as the reason.
 *
 * See docs/kb/patterns/bridging-runtime-a11y.md for the full guide.
 */

// ---------------------------------------------------------------------------
// Minimal type stubs matching the axe-core JSON output shape.
// No axe-core import — the agent reads the report file directly.
// ---------------------------------------------------------------------------

interface AxeNode {
  readonly html: string;
  readonly target: readonly string[];
  readonly failureSummary?: string;
}

interface AxeResult {
  readonly id: string;
  readonly impact: string | null;
  readonly tags: readonly string[];
  readonly description: string;
  readonly nodes: readonly AxeNode[];
}

interface AxeReport {
  readonly timestamp: string;
  readonly url: string;
  readonly violations: readonly AxeResult[];
  readonly passes: readonly AxeResult[];
}

// ---------------------------------------------------------------------------
// Mapping from axe rule ID to ra11y/WCAG criterion ID.
//
// Only a representative subset — extend as needed. Axe tags carry the
// WCAG criterion number (e.g. "wcag143" → wcag22:1.4.3); the mapping
// below is derived from those tags, not from axe internals.
// ---------------------------------------------------------------------------

const AXE_RULE_TO_CRITERION: Readonly<Record<string, string>> = {
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
};

// ---------------------------------------------------------------------------
// Bridge: axe violations → attest with verdict "fail"
// ---------------------------------------------------------------------------

/**
 * Builds the `attest` call parameters for each axe violation.
 * The agent passes these to the MCP `attest` tool one at a time.
 */
function bridgeViolations(
  report: AxeReport,
  by: string,
): ReadonlyArray<{
  criterionId: string;
  verdict: "fail";
  reason: string;
  by: string;
  attestedAt: string;
}> {
  const out: Array<{
    criterionId: string;
    verdict: "fail";
    reason: string;
    by: string;
    attestedAt: string;
  }> = [];

  for (const violation of report.violations) {
    const criterionId = AXE_RULE_TO_CRITERION[violation.id];
    if (criterionId === undefined) {
      // Unknown axe rule — skip; the agent should investigate and add a mapping.
      continue;
    }
    const nodeDescriptions = violation.nodes
      .slice(0, 3)
      .map((n) => n.failureSummary ?? n.html)
      .join("; ");
    out.push({
      criterionId,
      verdict: "fail",
      reason: `axe-core ${report.timestamp}: rule "${violation.id}" failed on ${violation.nodes.length} node(s). ${nodeDescriptions}`,
      by,
      attestedAt: report.timestamp,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bridge: axe passes → attest with verdict "pass"
// ---------------------------------------------------------------------------

/**
 * Builds the `attest` call parameters for each axe passing check.
 * Only passes with a known criterion mapping are bridged.
 */
function bridgePasses(
  report: AxeReport,
  by: string,
): ReadonlyArray<{
  criterionId: string;
  verdict: "pass";
  reason: string;
  by: string;
  attestedAt: string;
}> {
  const out: Array<{
    criterionId: string;
    verdict: "pass";
    reason: string;
    by: string;
    attestedAt: string;
  }> = [];

  for (const pass of report.passes) {
    const criterionId = AXE_RULE_TO_CRITERION[pass.id];
    if (criterionId === undefined) continue;
    out.push({
      criterionId,
      verdict: "pass",
      reason: `axe-core ${report.timestamp}: rule "${pass.id}" passed on ${pass.nodes.length} node(s). ${pass.description}`,
      by,
      attestedAt: report.timestamp,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point: produce the full list of attest calls for the agent.
// ---------------------------------------------------------------------------

/**
 * Given an axe-core report, returns every `attest` payload the agent
 * should dispatch — violations first, passes second.
 *
 * Usage (agent pseudocode):
 *   const report = JSON.parse(readFile("axe-report.json"));
 *   const payloads = buildAttestPayloads(report, "axe-core+ci");
 *   for (const payload of payloads) {
 *     await mcp.call("attest", payload);
 *   }
 */
export function buildAttestPayloads(
  report: AxeReport,
  by = "axe-core+ci",
): ReadonlyArray<{
  criterionId: string;
  verdict: "pass" | "fail";
  reason: string;
  by: string;
  attestedAt: string;
}> {
  return [...bridgeViolations(report, by), ...bridgePasses(report, by)];
}
