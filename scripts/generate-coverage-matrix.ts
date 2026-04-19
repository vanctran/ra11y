#!/usr/bin/env bun
/**
 * Generates docs/kb/standards/coverage.md — an authoritative per-criterion
 * coverage matrix for every built-in standard.
 *
 * For each criterion the matrix records:
 *   - The criterion ID, title, and level
 *   - The automatable classification from the standard definition
 *   - Which built-in rules satisfy the criterion (direct or via equivalentTo)
 *   - Which built-in finders surface candidates for the criterion (direct or via equivalentTo)
 *   - A coverage verdict: rule | finder | attestation-only | gap
 *
 * Verdict semantics:
 *   rule             — at least one rule satisfies the criterion
 *   finder           — at least one finder covers it; no rule does
 *   attestation-only — criterion is manual (automatable: "manual") and no
 *                      rule or finder covers it; the only path to conformance
 *                      is a human attestation or attest MCP tool call
 *   gap              — criterion is auto/partial but no rule or finder covers it
 *
 * Coverage lookup uses a two-step expansion so thin standards (Section 508,
 * EN 301 549) that declare equivalentTo edges get inherited coverage from
 * WCAG 2.2 rules without requiring those rules to enumerate every standard's
 * criterion ID. The expansion is one level deep — the same depth the
 * criteria registry uses.
 *
 * Run: bun scripts/generate-coverage-matrix.ts
 * Output: docs/kb/standards/coverage.md (overwritten on every run)
 *
 * Export: generateCoverageMatrix() returns the full markdown string so
 * check-kb-drift.ts can regenerate in memory and diff against on-disk.
 *
 * Never edit the output file by hand; it will be overwritten.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_CANDIDATE_FINDERS } from "../src/review/index.ts";
import { BUILTIN_RULES } from "../src/rules/index.ts";
import { BUILTIN_STANDARDS } from "../src/standards/index.ts";
import type { Criterion } from "../src/types/standard.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");

// ---------------------------------------------------------------------------
// Core generation function — exported for the drift check
// ---------------------------------------------------------------------------

type Verdict = "rule" | "finder" | "attestation-only" | "gap";

interface StandardSummary {
  total: number;
  rule: number;
  finder: number;
  attestationOnly: number;
  gap: number;
}

/** Builds a criterion-ID → ID-list index from a list of satisfies/criterionIds arrays. */
function buildCriterionIndex(
  pairs: ReadonlyArray<readonly [string, readonly string[]]>,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [id, cids] of pairs) {
    for (const cid of cids) {
      let list = index.get(cid);
      if (!list) {
        list = [];
        index.set(cid, list);
      }
      list.push(id);
    }
  }
  return index;
}

/**
 * Returns IDs covering a criterion — direct + one-level equivalentTo
 * expansion (same depth the criteria registry uses), deduped and sorted.
 */
function idsForCriterion(c: Criterion, index: Map<string, string[]>): string[] {
  const direct = index.get(c.id) ?? [];
  const viaEquiv = (c.equivalentTo ?? []).flatMap((eq) => index.get(eq) ?? []);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...direct, ...viaEquiv]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result.sort();
}

function criterionVerdict(
  c: Criterion,
  ruleIndex: Map<string, string[]>,
  finderIndex: Map<string, string[]>,
): Verdict {
  if (idsForCriterion(c, ruleIndex).length > 0) return "rule";
  if (idsForCriterion(c, finderIndex).length > 0) return "finder";
  if (c.automatable === "manual") return "attestation-only";
  return "gap";
}

/**
 * Renders a list of IDs compactly. Finders strip the "review/" prefix.
 * Lists longer than 2 show the first 2 plus a "+N" count.
 */
function renderIds(ids: string[], kind: "rule" | "finder"): string {
  if (ids.length === 0) return "—";
  const short = kind === "finder" ? ids.map((id) => id.replace(/^review\//, "")) : ids.slice();
  if (short.length <= 2) return short.join(", ");
  return `${short.slice(0, 2).join(", ")} +${short.length - 2}`;
}

function renderTable(
  criteria: readonly Criterion[],
  ruleIndex: Map<string, string[]>,
  finderIndex: Map<string, string[]>,
): string {
  const rows: string[] = [
    "| Criterion | Title | Level | Auto | Rules | Finders | Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of criteria) {
    const rules = idsForCriterion(c, ruleIndex);
    const finders = idsForCriterion(c, finderIndex);
    const v = criterionVerdict(c, ruleIndex, finderIndex);
    rows.push(
      `| \`${c.id}\` | ${c.title} | ${c.level} | ${c.automatable} | ${renderIds(rules, "rule")} | ${renderIds(finders, "finder")} | **${v}** |`,
    );
  }
  return rows.join("\n");
}

function summarize(
  criteria: readonly Criterion[],
  ruleIndex: Map<string, string[]>,
  finderIndex: Map<string, string[]>,
): StandardSummary {
  const s: StandardSummary = { total: 0, rule: 0, finder: 0, attestationOnly: 0, gap: 0 };
  for (const c of criteria) {
    s.total++;
    const v = criterionVerdict(c, ruleIndex, finderIndex);
    if (v === "rule") s.rule++;
    else if (v === "finder") s.finder++;
    else if (v === "attestation-only") s.attestationOnly++;
    else s.gap++;
  }
  return s;
}

function renderStandardSection(
  std: (typeof BUILTIN_STANDARDS)[number],
  ruleIndex: Map<string, string[]>,
  finderIndex: Map<string, string[]>,
): string {
  const s = summarize(std.criteria, ruleIndex, finderIndex);
  return [
    `## ${std.name}`,
    "",
    `**ID:** \`${std.id}\` | **Version:** ${std.version} | **Criteria:** ${s.total}`,
    "",
    `Coverage: ${s.rule} rule · ${s.finder} finder · ${s.attestationOnly} attestation-only · ${s.gap} gap`,
    "",
    renderTable(std.criteria, ruleIndex, finderIndex),
    "",
  ].join("\n");
}

function buildHeader(
  allCriteria: Map<string, Criterion>,
  totals: { rule: number; finder: number; attestation: number; gap: number },
): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "---",
    'title: "Coverage Matrix"',
    'description: "Per-criterion rule and finder coverage across all built-in standards."',
    `generated: "${today}"`,
    "---",
    "",
    "# Coverage Matrix",
    "",
    "This file is generated by `scripts/generate-coverage-matrix.ts`. Do not edit by hand.",
    "",
    "The matrix shows, for each criterion in every built-in standard, which rules and",
    "finders cover it and the resulting coverage verdict.",
    "",
    "**Verdict definitions:**",
    "",
    "- `rule` — at least one built-in rule statically checks this criterion",
    "- `finder` — at least one built-in finder surfaces candidates for human review; no rule covers it",
    "- `attestation-only` — criterion is `manual`; no static coverage exists; conformance requires human attestation",
    "- `gap` — criterion is `full` or `partial` automatable but no rule or finder covers it yet",
    "",
    "**Rules column** shows rule IDs (up to 2; `+N` for more).",
    "**Finders column** strips the `review/` prefix for brevity.",
    "",
    `**Unique criteria across all standards:** ${allCriteria.size}`,
    `**By verdict:** ${totals.rule} rule · ${totals.finder} finder · ${totals.attestation} attestation-only · ${totals.gap} gap`,
    "",
  ];
}

function buildGapSection(gaps: string[]): string[] {
  if (gaps.length === 0) return [];
  return [
    "## Gaps",
    "",
    "The following criterion IDs have `gap` verdict — they are auto/partial automatable but have no rule or finder coverage yet.",
    "These are candidates for new rules or finders.",
    "",
    ...gaps.map((id) => `- \`${id}\``),
    "",
  ];
}

function collectUniqueCriteria(): Map<string, Criterion> {
  const allCriteria = new Map<string, Criterion>();
  for (const std of BUILTIN_STANDARDS) {
    for (const c of std.criteria) {
      if (!allCriteria.has(c.id)) allCriteria.set(c.id, c);
    }
  }
  return allCriteria;
}

function computeTotals(
  allCriteria: Map<string, Criterion>,
  ruleIndex: Map<string, string[]>,
  finderIndex: Map<string, string[]>,
): { rule: number; finder: number; attestation: number; gap: number; gaps: string[] } {
  let rule = 0;
  let finder = 0;
  let attestation = 0;
  let gap = 0;
  const gapIds: string[] = [];
  for (const c of allCriteria.values()) {
    const v = criterionVerdict(c, ruleIndex, finderIndex);
    if (v === "rule") rule++;
    else if (v === "finder") finder++;
    else if (v === "attestation-only") attestation++;
    else {
      gap++;
      gapIds.push(c.id);
    }
  }
  return { rule, finder, attestation, gap, gaps: gapIds.sort() };
}

/**
 * Builds and returns the full markdown content of the coverage matrix.
 * Pure function: no file I/O. Idempotent — same inputs produce identical output.
 *
 * @returns Markdown string ready to write to docs/kb/standards/coverage.md.
 */
export function generateCoverageMatrix(): string {
  const ruleIndex = buildCriterionIndex(BUILTIN_RULES.map((r) => [r.id, r.satisfies] as const));
  const finderIndex = buildCriterionIndex(
    BUILTIN_CANDIDATE_FINDERS.map((f) => [f.id, f.criterionIds] as const),
  );
  const allCriteria = collectUniqueCriteria();
  const totals = computeTotals(allCriteria, ruleIndex, finderIndex);

  const sections: string[] = [...buildHeader(allCriteria, totals), ...buildGapSection(totals.gaps)];
  for (const std of BUILTIN_STANDARDS) {
    sections.push(renderStandardSection(std, ruleIndex, finderIndex));
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Write when run directly (not when imported by check-kb-drift)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const OUT = join(ROOT, "docs", "kb", "standards", "coverage.md");
  writeFileSync(OUT, generateCoverageMatrix());
  console.log(`✓ coverage matrix written → ${OUT}`);
}
