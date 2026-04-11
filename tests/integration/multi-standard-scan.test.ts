/**
 * The architectural claim: one rule, four standards, zero duplication.
 *
 * `media/alt-text-missing` declares `satisfies: ["wcag22:1.1.1",
 * "wcag21:1.1.1"]`. It does NOT know about Section 508 or EN 301 549.
 *
 * But when the user enables all four standards, the criteria registry's
 * reciprocal closure walks equivalentTo edges:
 *
 *   section508:1.1.1   →   wcag22:1.1.1   (declared by section508)
 *   en301549:9.1.1.1   →   wcag22:1.1.1   (declared by en301549)
 *   wcag21:1.1.1       ↔   wcag22:1.1.1   (declared by both)
 *
 * so the standard-filter's citedCriteria() returns all four IDs for
 * every violation. This test proves that the moat actually works —
 * rules stay standard-agnostic, standards are pure data, and the
 * engine does the fan-out automatically.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runScan, type ParsedFile } from "../../src/engine/scanner.ts";
import { parseHtml } from "../../src/input/parsers/index.ts";
import { BUILTIN_RULES } from "../../src/rules/index.ts";
import { BUILTIN_STANDARDS } from "../../src/standards/index.ts";
import type { Ast } from "../../src/types/ast.ts";

const FIXTURE = join(
  import.meta.dir,
  "..",
  "fixtures",
  "bad",
  "alt-text-missing",
  "img-no-alt.html",
);

function loadBadFixture(): ParsedFile {
  const source = readFileSync(FIXTURE, "utf8");
  const parsed = parseHtml(source);
  const ast: Ast = { language: "html", root: parsed.root, errors: parsed.errors };
  return { filePath: "index.html", source, ast };
}

describe("multi-standard cross-reference via equivalentTo closure", () => {
  it("a single rule satisfying wcag22:1.1.1 fires violations that cite all four standards when all four are enabled", () => {
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21", "section508", "en301549"],
      files: [loadBadFixture()],
    });

    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    if (!violation) throw new Error("expected a violation");

    // All four standards should appear in the criteria list — sorted
    // deterministically by the standard-filter.
    const cited = [...violation.criteria].sort();
    expect(cited).toContain("wcag22:1.1.1");
    expect(cited).toContain("wcag21:1.1.1");
    expect(cited).toContain("section508:1.1.1");
    expect(cited).toContain("en301549:9.1.1.1");
  });

  it("enabling only section508 cites section508:1.1.1 (not wcag22/wcag21/en301549) on the same rule", () => {
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: BUILTIN_RULES,
      enabled: ["section508"],
      files: [loadBadFixture()],
    });

    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    if (!violation) throw new Error("expected a violation");

    expect(violation.criteria).toContain("section508:1.1.1");
    for (const id of violation.criteria) {
      expect(id.startsWith("section508:")).toBe(true);
    }
  });

  it("enabling only en301549 cites en301549:9.1.1.1 on the same rule", () => {
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: BUILTIN_RULES,
      enabled: ["en301549"],
      files: [loadBadFixture()],
    });

    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    if (!violation) throw new Error("expected a violation");

    expect(violation.criteria).toContain("en301549:9.1.1.1");
    for (const id of violation.criteria) {
      expect(id.startsWith("en301549:")).toBe(true);
    }
  });

  it("coverage report breaks down per enabled standard", () => {
    const { report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: BUILTIN_RULES,
      enabled: ["wcag22", "wcag21", "section508", "en301549"],
      files: [loadBadFixture()],
    });

    const ids = report.coverage.map((c) => c.standardId).sort();
    expect(ids).toEqual(["en301549", "section508", "wcag21", "wcag22"]);

    // Every coverage entry should have non-zero total criteria.
    for (const entry of report.coverage) {
      expect(entry.total).toBeGreaterThan(0);
      expect(entry.automated).toBeGreaterThan(0);
    }
  });

  it("wcag22 alone still works (default path) — validates the default-case didn't break", () => {
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [loadBadFixture()],
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.criteria).toContain("wcag22:1.1.1");
    // Only wcag22 enabled → only wcag22 cited.
    for (const id of result.violations[0]?.criteria ?? []) {
      expect(id.startsWith("wcag22:")).toBe(true);
    }
  });
});
