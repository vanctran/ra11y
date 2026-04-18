/**
 * Unit tests for buildPerRuleCoverage — the confidence-annotation step
 * the scanner folds over its evaluation tracker.
 *
 * Three shapes matter:
 *   - eligible === 0 on a rule with an extension gate → low, with a
 *     specific reason + remediation (the Tailwind-pre-build case for
 *     `.css`-targeted rules is the acute one).
 *   - eligible > 0, evaluated > 0 → high.
 *   - eligible > 0, evaluated === 0 → low with the "excluded or empty"
 *     reason (path the tracker can't reach today, but the branch
 *     exists so the shape stays honest if the scanner grows a
 *     skip-after-parse step).
 *   - Unconstrained rules (no fileExtensions) are omitted from the
 *     output — they can't produce a low-confidence row by definition,
 *     so including them would be noise.
 */

import { describe, expect, it } from "bun:test";
import { buildPerRuleCoverage } from "../../../src/engine/per-rule-coverage.ts";
import type { RuleEvaluationTracker } from "../../../src/engine/rule-runner.ts";
import type { StandardFilter } from "../../../src/engine/standard-filter.ts";
import type { Rule } from "../../../src/types/rule.ts";

function mkRule(id: string, extensions?: readonly string[]): Rule {
  return {
    id,
    satisfies: ["wcag22:1.4.3"],
    severity: "warning",
    scope: "node",
    fixClass: "guidance",
    ...(extensions === undefined ? {} : { appliesTo: { fileExtensions: extensions } }),
    docs: {
      description: "test",
      rationale: "test",
      goodExample: "",
      badExample: "",
      references: [],
    },
  };
}

const passAllFilter: StandardFilter = {
  isRuleActive: () => true,
  citedCriteria: () => ["wcag22:1.4.3"],
  citedCriteriaTitles: () => ["Contrast (Minimum)"],
};

function tracker(
  entries: Record<string, { eligible: number; evaluated: number }>,
): RuleEvaluationTracker {
  const counts = new Map<string, { eligible: number; evaluated: number }>();
  for (const [k, v] of Object.entries(entries)) counts.set(k, { ...v });
  return { counts };
}

describe("buildPerRuleCoverage", () => {
  it("marks a rule with 0 eligible files as low confidence with reason + remediation", () => {
    const rules = [mkRule("contrast/minimum", [".css"])];
    const entries = buildPerRuleCoverage(
      tracker({ "contrast/minimum": { eligible: 0, evaluated: 0 } }),
      rules,
      passAllFilter,
    );
    expect(entries.length).toBe(1);
    const [row] = entries;
    expect(row!.ruleId).toBe("contrast/minimum");
    expect(row!.filesEligible).toBe(0);
    expect(row!.filesEvaluated).toBe(0);
    expect(row!.coverageConfidence).toBe("low");
    expect(row!.reason).toContain(".css");
    expect(row!.remediation).toContain("additionalPaths");
  });

  it("marks a rule that ran on at least one file as high confidence (reason/remediation omitted)", () => {
    const rules = [mkRule("media/alt-text-missing", [".html", ".htm", ".tsx", ".jsx"])];
    const entries = buildPerRuleCoverage(
      tracker({ "media/alt-text-missing": { eligible: 3, evaluated: 3 } }),
      rules,
      passAllFilter,
    );
    const [row] = entries;
    expect(row!.coverageConfidence).toBe("high");
    expect(row!.filesEligible).toBe(3);
    expect(row!.filesEvaluated).toBe(3);
    expect(row!.reason).toBeUndefined();
    expect(row!.remediation).toBeUndefined();
  });

  it("omits rules without an extension gate from the output", () => {
    const rules = [mkRule("noop", undefined)];
    const entries = buildPerRuleCoverage(
      tracker({ noop: { eligible: 5, evaluated: 5 } }),
      rules,
      passAllFilter,
    );
    expect(entries.length).toBe(0);
  });

  it("omits filter-inactive rules (rule disabled under current standards)", () => {
    const rules = [mkRule("contrast/minimum", [".css"])];
    const filter: StandardFilter = {
      isRuleActive: () => false,
      citedCriteria: () => [],
      citedCriteriaTitles: () => [],
    };
    const entries = buildPerRuleCoverage(
      tracker({ "contrast/minimum": { eligible: 0, evaluated: 0 } }),
      rules,
      filter,
    );
    expect(entries.length).toBe(0);
  });

  it("sorts entries by rule ID for cross-run stability", () => {
    const rules = [
      mkRule("z/last", [".css"]),
      mkRule("a/first", [".html"]),
      mkRule("m/middle", [".tsx"]),
    ];
    const entries = buildPerRuleCoverage(
      tracker({
        "z/last": { eligible: 1, evaluated: 1 },
        "a/first": { eligible: 1, evaluated: 1 },
        "m/middle": { eligible: 1, evaluated: 1 },
      }),
      rules,
      passAllFilter,
    );
    expect(entries.map((e) => e.ruleId)).toEqual(["a/first", "m/middle", "z/last"]);
  });

  it("names CSS / HTML / JSX-TSX remediation text on zero-eligible rows", () => {
    const rules = [
      mkRule("contrast/minimum", [".css"]),
      mkRule("page/titled", [".html", ".htm"]),
      mkRule("nav/skip-link", [".tsx", ".jsx"]),
    ];
    const entries = buildPerRuleCoverage(
      tracker({
        "contrast/minimum": { eligible: 0, evaluated: 0 },
        "page/titled": { eligible: 0, evaluated: 0 },
        "nav/skip-link": { eligible: 0, evaluated: 0 },
      }),
      rules,
      passAllFilter,
    );
    const byId = new Map(entries.map((e) => [e.ruleId, e]));
    expect(byId.get("contrast/minimum")!.remediation).toContain("CSS");
    expect(byId.get("page/titled")!.remediation).toContain("HTML");
    expect(byId.get("nav/skip-link")!.remediation).toContain("JSX/TSX");
  });
});
