/**
 * `ra11y --certification` — readiness scorecard as Markdown.
 *
 * Reads `.ra11y-manual.json` from cwd if present to factor manual
 * reviews into the score; otherwise treats manual criteria as
 * pending.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { type ParsedFile, runScan } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseHtml, parseTsx } from "../../input/parsers/index.ts";
import type { ManualReview } from "../../reports/certification.ts";
import {
  buildCertificationScorecard,
  buildCoverageReport,
  renderCertificationMarkdown,
} from "../../reports/index.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import type { Ast } from "../../types/ast.ts";
import type { CliOptions } from "../args.ts";
import type { ScanExit } from "./scan.ts";

export async function runCertification(options: CliOptions): Promise<ScanExit> {
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
    level: options.level,
  });

  const manual = await loadManualReview(cwd);
  const coverage = buildCoverageReport(result, BUILTIN_STANDARDS);
  const scores = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, manual, options.level);
  return { stdout: renderCertificationMarkdown(scores), stderr: "", exitCode: 0 };
}

async function loadManualReview(cwd: string): Promise<ManualReview> {
  const manualPath = join(cwd, ".ra11y-manual.json");
  if (!existsSync(manualPath)) return {};
  try {
    const raw = await readFile(manualPath, "utf8");
    return JSON.parse(raw) as ManualReview;
  } catch {
    return {};
  }
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
    const r = parseTsx(source, { filePath });
    return { language: "tsx", root: r.root, errors: r.errors };
  }
  return null;
}
