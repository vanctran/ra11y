/**
 * End-to-end proof that `criteriaTitles` is populated alongside
 * `criteria` on every emitted Violation, and that the field is:
 *
 *   1. Aligned index-for-index with `criteria` (the load-bearing
 *      invariant documented on `Violation.criteriaTitles` — consumers
 *      zip the two arrays).
 *   2. Forwarded through the JSON and agent formatters.
 *   3. Forwarded through `buildAgentFinding` (the shared
 *      `src/output/agent-response/` builder every MCP tool and the CLI
 *      agent formatter consumes) so every tool response benefits
 *      without per-handler wiring.
 *
 * The test uses a real rule (`media/alt-text-missing`) scanned against a
 * real standard (WCAG 2.2) so the title lookup resolves against live
 * standards data — a regression in `standard-filter.citedCriteriaTitles`
 * or the criteria registry would surface here, not just in the helper
 * unit test.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../src/engine/scanner.ts";
import { parseHtml } from "../../src/input/parsers/index.ts";
import { buildAgentFinding } from "../../src/output/agent-response/index.ts";
import { agentFormatter } from "../../src/output/formatters/agent.ts";
import { jsonFormatter } from "../../src/output/formatters/json.ts";
import { BUILTIN_RULES } from "../../src/rules/index.ts";
import { wcag21 } from "../../src/standards/wcag21/standard.ts";
import { wcag22 } from "../../src/standards/wcag22/standard.ts";
import type { Ast } from "../../src/types/ast.ts";

function parseHtmlFile(filePath: string, source: string): ParsedFile {
  const r = parseHtml(source);
  const ast: Ast = { language: "html", root: r.root, errors: r.errors };
  return { filePath, source, ast };
}

// An `<img>` with no `alt` attribute — deterministic trigger for
// `media/alt-text-missing`, which satisfies WCAG 2.2 and WCAG 2.1 §1.1.1
// ("Non-text Content"). Running both standards exercises multi-ID alignment.
const BAD_HTML = '<!doctype html><html><body><img src="x.png"></body></html>';

describe("criteriaTitles — end-to-end alignment", () => {
  it("every emitted violation carries criteriaTitles aligned index-for-index with criteria", () => {
    const { result } = runScan({
      standards: [wcag22, wcag21],
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21"],
      files: [parseHtmlFile("input.html", BAD_HTML)],
    });

    expect(result.violations.length).toBeGreaterThan(0);

    for (const v of result.violations) {
      // Every real emitted violation carries the field.
      expect(v.criteriaTitles).toBeDefined();
      // Same cardinality as `criteria` — the load-bearing invariant.
      expect(v.criteriaTitles).toHaveLength(v.criteria.length);
      // No empty-string sentinels: unresolved IDs fall back to the ID.
      for (const title of v.criteriaTitles ?? []) {
        expect(title.length).toBeGreaterThan(0);
      }
    }
  });

  it("the alt-text violation resolves wcag22:1.1.1 → 'Non-text Content'", () => {
    const { result } = runScan({
      standards: [wcag22, wcag21],
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21"],
      files: [parseHtmlFile("input.html", BAD_HTML)],
    });

    const altViolation = result.violations.find((v) => v.ruleId === "media/alt-text-missing");
    expect(altViolation).toBeDefined();

    // Find the index of wcag22:1.1.1 in `criteria`, then assert the
    // same index in `criteriaTitles` is the human title. This is the
    // alignment invariant, spelled out: not just "the titles array
    // contains 'Non-text Content'," but "the title at the right index
    // is 'Non-text Content'."
    const idx = altViolation!.criteria.indexOf("wcag22:1.1.1");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(altViolation!.criteriaTitles?.[idx]).toBe("Non-text Content");

    // Both WCAG standards surface this rule via equivalentTo — the
    // title for wcag21:1.1.1 at its own index is also "Non-text Content."
    const idx21 = altViolation!.criteria.indexOf("wcag21:1.1.1");
    if (idx21 >= 0) {
      expect(altViolation!.criteriaTitles?.[idx21]).toBe("Non-text Content");
    }
  });

  it("JSON formatter carries criteriaTitles index-aligned with criteria", () => {
    const { result, report } = runScan({
      standards: [wcag22, wcag21],
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21"],
      files: [parseHtmlFile("input.html", BAD_HTML)],
    });

    const raw = jsonFormatter.format(result, report);
    const parsed = JSON.parse(raw) as {
      result: {
        violations: Array<{
          ruleId: string;
          criteria: string[];
          criteriaTitles?: string[];
        }>;
      };
    };

    const alt = parsed.result.violations.find((v) => v.ruleId === "media/alt-text-missing");
    expect(alt).toBeDefined();
    expect(alt!.criteriaTitles).toBeDefined();
    expect(alt!.criteriaTitles).toHaveLength(alt!.criteria.length);
    const idx = alt!.criteria.indexOf("wcag22:1.1.1");
    expect(alt!.criteriaTitles![idx]).toBe("Non-text Content");
  });

  it("agent formatter carries criteriaTitles index-aligned with criteria", () => {
    const { result, report } = runScan({
      standards: [wcag22, wcag21],
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21"],
      files: [parseHtmlFile("input.html", BAD_HTML)],
    });

    const raw = agentFormatter.format(result, report);
    const parsed = JSON.parse(raw) as {
      files: Array<{
        findings: Array<{ ruleId: string; criteria: string[]; criteriaTitles?: string[] }>;
      }>;
    };

    const finding = parsed.files
      .flatMap((f) => f.findings)
      .find((f) => f.ruleId === "media/alt-text-missing");
    expect(finding).toBeDefined();
    expect(finding!.criteriaTitles).toBeDefined();
    expect(finding!.criteriaTitles).toHaveLength(finding!.criteria.length);
    const idx = finding!.criteria.indexOf("wcag22:1.1.1");
    expect(finding!.criteriaTitles![idx]).toBe("Non-text Content");
  });

  it("buildAgentFinding forwards criteriaTitles so every MCP tool response benefits", () => {
    const { result } = runScan({
      standards: [wcag22, wcag21],
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21"],
      files: [parseHtmlFile("input.html", BAD_HTML)],
    });

    const altViolation = result.violations.find((v) => v.ruleId === "media/alt-text-missing");
    expect(altViolation).toBeDefined();

    const formatted = buildAgentFinding(altViolation!);
    expect(formatted.criteriaTitles).toBeDefined();
    expect(formatted.criteriaTitles).toHaveLength(formatted.criteria.length);
    const idx = formatted.criteria.indexOf("wcag22:1.1.1");
    expect(formatted.criteriaTitles?.[idx]).toBe("Non-text Content");
  });

  it("a violation with empty criteria has empty criteriaTitles (empty-in → empty-out)", () => {
    // Synthetic rule-crash violations carry `criteria: []` — those
    // don't go through the filter (they're constructed directly by the
    // scanner's error path). The invariant is "same cardinality," so
    // criteria: [] must be paired with either absent or empty
    // criteriaTitles — never a mis-aligned sentinel. buildAgentFinding's
    // conditional spread absorbs the absent case; the unit test for
    // `titlesForCriteria([])` covers the empty-array branch directly.
    // We assert both observable states here.

    // Build a synthetic Violation with criteria: [] and no
    // criteriaTitles — verify buildAgentFinding omits the field rather
    // than emitting `criteriaTitles: []` as a lying placeholder.
    const synthetic = {
      findingId: "deadbeef0000",
      groupKey: "deadbeef0001",
      ruleId: "internal/rule-crash",
      fixClass: "verify-in-source" as const,
      criteria: [] as readonly string[],
      severity: "error" as const,
      location: { filePath: "input.html", line: 1, column: 1 },
      message: "synthetic",
    };
    const out = buildAgentFinding(synthetic);
    expect(out.criteria).toEqual([]);
    expect(Object.hasOwn(out, "criteriaTitles")).toBe(false);

    // Conversely, when the engine does stamp titles alongside an empty
    // criteria list (project-rule path with a filter that yields zero
    // criteria), the field is present as an empty array — aligned
    // cardinality, no ambiguity.
    const withEmptyTitles = { ...synthetic, criteriaTitles: [] as readonly string[] };
    const out2 = buildAgentFinding(withEmptyTitles);
    expect(out2.criteriaTitles).toEqual([]);
  });
});
