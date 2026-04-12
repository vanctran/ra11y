/**
 * `ra11y --coverage` — per-standard automation coverage table.
 *
 * Runs a normal scan and renders the coverage report as a compact
 * terminal-friendly summary. Exit code is always 0 — this is a
 * reporting command, not a gate.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { ParsedFile } from "../../engine/scanner.ts";
import { runScan } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseHtml, parseTsx } from "../../input/parsers/index.ts";
import { buildCoverageReport } from "../../reports/coverage.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import type { Ast } from "../../types/ast.ts";
import type { CliOptions } from "../args.ts";
import type { ScanExit } from "./scan.ts";

export async function runCoverage(options: CliOptions): Promise<ScanExit> {
  // Validate standards — reuse scan command's validation shape by
  // calling runScanCommand when we need the full pipeline. But for
  // --coverage we want our own rendering, so inline the parsing +
  // scan and then render the coverage view.

  const cwd = process.cwd();
  const roots = options.positionals.length > 0 ? options.positionals : [cwd];
  const discovered = await discoverFiles(roots, { excludes: options.exclude });

  const parsed: ParsedFile[] = [];
  for (const filePath of discovered) {
    const source = await readFile(filePath, "utf8");
    const ast = parseFor(filePath, source);
    if (!ast) continue;
    parsed.push({ filePath: relative(cwd, filePath), source, ast });
  }

  const { result } = runScan({
    standards: BUILTIN_STANDARDS,
    rules: BUILTIN_RULES,
    enabled: options.standards,
    files: parsed,
  });

  const coverage = buildCoverageReport(result, BUILTIN_STANDARDS);
  return { stdout: renderCoverageSummary(coverage), stderr: "", exitCode: 0 };
}

function parseFor(filePath: string, source: string): Ast | null {
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
    const r = parseHtml(source);
    return { language: "html", root: r.root, errors: r.errors };
  }
  if (
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".ts") ||
    filePath.endsWith(".js")
  ) {
    const r = parseTsx(source);
    return { language: "tsx", root: r.root, errors: r.errors };
  }
  return null;
}

function renderCoverageSummary(
  coverage: readonly import("../../reports/coverage.ts").PerStandardCoverage[],
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Coverage");
  lines.push("");
  for (const entry of coverage) {
    const passing = `${entry.passing}/${entry.automatable}`;
    lines.push(
      `    ${entry.standardName.padEnd(32)}  ${passing.padStart(6)} automatable passing  (${entry.automatedPassRate}%)  ·  ${entry.manual} need manual review`,
    );
    if (entry.failingCriteria.length > 0) {
      const preview = entry.failingCriteria.slice(0, 5).join(", ");
      const rest =
        entry.failingCriteria.length > 5 ? `, … ${entry.failingCriteria.length - 5} more` : "";
      lines.push(`      failing: ${preview}${rest}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
