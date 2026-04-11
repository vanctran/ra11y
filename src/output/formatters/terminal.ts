/**
 * Terminal formatter — the default human-readable output.
 *
 * Produces grouped-per-file output with box-drawing, severity glyphs,
 * WCAG citations, and context-aware fix suggestions. Strictly
 * deterministic: same ScanResult in, same string out. Non-TTY mode
 * suppresses colors automatically via the ansi module's state.
 *
 * Layout:
 *
 *   ra11y v<version>
 *
 *   ┌─ <file> ─────────────────────────────────────────────────
 *   │
 *   │  ✗  12:5   media/alt-text-missing
 *   │            <message>
 *   │            WCAG 2.2 · 1.1.1 Non-text Content · Level A
 *   │            Fix: <suggestion>
 *   │
 *   └──────────────────────────────────────────────────────────
 *
 *   ✗ N errors   ⚠ M warnings   ℹ K info     in F files · Tms
 *
 *   Coverage   X of Y automatable SC checked · Z need manual review
 */

import { defineFormatter } from "../../api/plugin.ts";
import { bold, brightCyan, brightYellow, dim, gray, magenta, red } from "../../utils/ansi.ts";
import { renderFileBox } from "../theme/layout.ts";
import { GLYPHS } from "../theme/symbols.ts";
import type { ScanResult, Violation } from "../../types/violation.ts";
import type { ReportData } from "../../types/violation.ts";

const VERSION = "0.0.0";

export const terminalFormatter = defineFormatter({
  id: "terminal",
  format(result: ScanResult, report: ReportData): string {
    const lines: string[] = [];
    lines.push("");
    lines.push(`  ${bold("ra11y")} ${dim(`v${VERSION}`)}`);
    lines.push("");

    const grouped = groupByFile(result.violations);
    for (const [file, violations] of grouped) {
      lines.push(renderFileBox(file, renderViolationBlock(violations)));
      lines.push("");
    }

    lines.push(renderSummary(result));
    lines.push("");
    lines.push(renderCoverage(result, report));

    return lines.join("\n");
  },
});

function renderViolationBlock(violations: readonly Violation[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    if (!v) continue;
    out.push(...renderOneViolation(v));
    if (i < violations.length - 1) out.push("");
  }
  return out;
}

function renderOneViolation(v: Violation): string[] {
  const glyph = severityGlyph(v.severity);
  const locLabel = `${v.location.line}:${v.location.column}`;
  const header = `${glyph}  ${dim(locLabel.padEnd(6))}  ${bold(v.ruleId)}`;
  const message = `            ${v.message}`;
  const lines = [header, message];
  if (v.criteria.length > 0) {
    lines.push(`            ${magenta(formatCriteria(v.criteria))}`);
  }
  if (v.suggestion) {
    lines.push(`            ${gray("Fix:")} ${v.suggestion}`);
  }
  return lines;
}

function severityGlyph(severity: Violation["severity"]): string {
  switch (severity) {
    case "error":
      return red(GLYPHS.error);
    case "warning":
      return brightYellow(GLYPHS.warning);
    case "info":
      return brightCyan(GLYPHS.info);
  }
}

function formatCriteria(criteria: readonly string[]): string {
  // Display the first WCAG-ish criterion with a human-ish label; the
  // rest we append in compact form so a long list doesn't dominate.
  const labels = criteria.map(labelForCriterion);
  const primary = labels[0];
  const extras = labels.slice(1);
  if (extras.length === 0) return primary ?? "";
  return `${primary} · also ${extras.join(", ")}`;
}

function labelForCriterion(id: string): string {
  // wcag22:1.1.1 → "WCAG 2.2 · 1.1.1"
  const [standard, local] = id.split(":");
  if (!standard || !local) return id;
  if (standard === "wcag22") return `WCAG 2.2 · ${local}`;
  if (standard === "wcag21") return `WCAG 2.1 · ${local}`;
  if (standard === "section508") return `Section 508 · ${local}`;
  if (standard === "en301549") return `EN 301 549 · ${local}`;
  return id;
}

function renderSummary(result: ScanResult): string {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const v of result.violations) {
    if (v.severity === "error") errors += 1;
    else if (v.severity === "warning") warnings += 1;
    else infos += 1;
  }
  const e = `${red(GLYPHS.error)} ${errors} ${pluralize("error", errors)}`;
  const w = `${brightYellow(GLYPHS.warning)} ${warnings} ${pluralize("warning", warnings)}`;
  const i = `${brightCyan(GLYPHS.info)} ${infos} ${pluralize("info", infos)}`;
  const duration = `${dim(`in ${result.filesScanned} ${pluralize("file", result.filesScanned)} · ${Math.round(result.durationMs)}ms`)}`;
  return `  ${e}   ${w}   ${i}   ${duration}`;
}

function renderCoverage(_result: ScanResult, report: ReportData): string {
  const lines: string[] = [];
  for (const entry of report.coverage) {
    const passingPct =
      entry.automated > 0 ? Math.round((entry.passing / entry.automated) * 100) : 0;
    lines.push(
      `  ${dim("Coverage")}  ${bold(labelForStandard(entry.standardId))}  ${entry.passing}/${entry.automated} automatable passing (${passingPct}%) · ${report.manualReviewNeeded.length} need manual review`,
    );
  }
  return lines.join("\n");
}

function labelForStandard(id: string): string {
  if (id === "wcag22") return "WCAG 2.2";
  if (id === "wcag21") return "WCAG 2.1";
  if (id === "section508") return "Section 508";
  if (id === "en301549") return "EN 301 549";
  return id;
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

function groupByFile(violations: readonly Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = map.get(v.location.filePath);
    if (existing) existing.push(v);
    else map.set(v.location.filePath, [v]);
  }
  return map;
}
