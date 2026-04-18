/**
 * Integration test for the per-finding `couldBeWrongBecause` field.
 *
 * See docs/adr/0009-violation-could-be-wrong-because.md. The field is
 * optional — rules that know their own false-positive axes populate it
 * at `ctx.emit()` time, and rules without known escape hatches omit
 * it. This test locks in the forwarder invariants for both populated
 * and unpopulated cases:
 *
 *   1. When the field is absent on the Violation, neither the shared
 *      `buildAgentFinding` output (consumed by every MCP tool) nor the
 *      `agent` formatter emits a `couldBeWrongBecause` key. This is
 *      the load-bearing shape
 *      hygiene — `couldBeWrongBecause: []` would be a dishonest
 *      empty-vs-unpopulated sentinel per CLAUDE.md §1.
 *   2. When the field is populated, both forwarders surface it with
 *      the same codes in the same order.
 *
 * No rule populates this field today; the scaffold lands shape only.
 * These tests construct synthetic Violations via `withFindingId` so
 * they remain valid when the first per-rule opt-in lands.
 */

import { describe, expect, it } from "bun:test";
import { buildAgentFinding } from "../../src/output/agent-response/index.ts";
import { agentFormatter } from "../../src/output/formatters/agent.ts";
import type { ReportData, ScanResult, Violation } from "../../src/types/violation.ts";
import { withFindingId } from "../helpers/make-violation.ts";

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return withFindingId({
    ruleId: "forms/required-indicator-missing",
    fixClass: "verify-in-source",
    criteria: ["wcag22:3.3.2"],
    severity: "warning",
    location: { filePath: "/src/widgets/FormField.tsx", line: 12, column: 5 },
    message: "wrapper forwards `required` but renders no visible marker",
    ...overrides,
  });
}

function formatterFinding(v: Violation): Record<string, unknown> {
  const scan: ScanResult = {
    violations: [v],
    filesScanned: 1,
    durationMs: 0,
    enabledStandards: ["wcag22"],
    isTTY: false,
    perRuleCoverage: [],
  };
  const report: ReportData = { coverage: [], manualReviewNeeded: [] };
  const payload = JSON.parse(agentFormatter.format(scan, report));
  const files = payload.files as ReadonlyArray<{
    findings: ReadonlyArray<Record<string, unknown>>;
  }>;
  const first = files[0]?.findings[0];
  if (!first) throw new Error("agent formatter emitted no findings");
  return first;
}

describe("Violation.couldBeWrongBecause", () => {
  describe("when absent on the Violation", () => {
    const v = makeViolation();

    it("buildAgentFinding omits the key entirely", () => {
      const out = buildAgentFinding(v);
      expect("couldBeWrongBecause" in out).toBe(false);
    });

    it("agent formatter omits the key entirely", () => {
      const finding = formatterFinding(v);
      expect("couldBeWrongBecause" in finding).toBe(false);
    });
  });

  describe("when empty on the Violation", () => {
    // Defensive: even if a rule author somehow hands us an empty
    // array, forwarders treat it as unpopulated. `couldBeWrongBecause:
    // []` must never reach the agent.
    const v = makeViolation({ couldBeWrongBecause: [] });

    it("buildAgentFinding omits the key", () => {
      const out = buildAgentFinding(v);
      expect("couldBeWrongBecause" in out).toBe(false);
    });

    it("agent formatter omits the key", () => {
      const finding = formatterFinding(v);
      expect("couldBeWrongBecause" in finding).toBe(false);
    });
  });

  describe("when populated", () => {
    const codes = ["replacement_indicator_in_sibling_file", "tailwind_class_on_consumer"] as const;
    const v = makeViolation({ couldBeWrongBecause: codes });

    it("buildAgentFinding surfaces the codes in order", () => {
      const out = buildAgentFinding(v);
      expect(out.couldBeWrongBecause).toEqual([...codes]);
    });

    it("agent formatter surfaces the codes in order", () => {
      const finding = formatterFinding(v);
      expect(finding["couldBeWrongBecause"]).toEqual([...codes]);
    });
  });
});
