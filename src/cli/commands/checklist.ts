/**
 * `ra11y --checklist` — generates a Markdown checklist of every
 * criterion that needs manual review, grouped by standard. Prints
 * to stdout; pipe into a file or a reviewer tool.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type ParsedFile, runScan } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseHtml, parseTsx } from "../../input/parsers/index.ts";
import {
  buildChecklist,
  buildCoverageReport,
  renderChecklistMarkdown,
} from "../../reports/index.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import type { Ast } from "../../types/ast.ts";
import type { CliOptions } from "../args.ts";
import type { ScanExit } from "./scan.ts";

export async function runChecklist(options: CliOptions): Promise<ScanExit> {
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
  const checklist = buildChecklist(coverage, BUILTIN_STANDARDS);
  const markdown = renderChecklistMarkdown(checklist);

  return { stdout: markdown, stderr: "", exitCode: 0 };
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
