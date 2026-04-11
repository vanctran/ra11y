/**
 * `ra11y scan` — the default command. Discovers files, parses them,
 * runs registered rules against the enabled standards, and prints
 * the formatted output to stdout.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { runScan, type ParsedFile } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseHtml, parseTsx } from "../../input/parsers/index.ts";
import { BUILTIN_FORMATTERS } from "../../output/formatters/index.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { wcag22 } from "../../standards/wcag22/standard.ts";
import type { Ast } from "../../types/ast.ts";
import type { Standard } from "../../types/standard.ts";
import type { CliOptions } from "../args.ts";

const LOADED_STANDARDS: readonly Standard[] = [wcag22];

const STANDARD_BY_ID: Readonly<Record<string, Standard>> = Object.fromEntries(
  LOADED_STANDARDS.map((s) => [s.id, s]),
);

export interface ScanExit {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export async function runScanCommand(options: CliOptions): Promise<ScanExit> {
  const cwd = process.cwd();
  const roots = options.positionals.length > 0 ? options.positionals : [cwd];

  // Validate requested standards before doing any work.
  const missing = options.standards.filter((id) => !(id in STANDARD_BY_ID));
  if (missing.length > 0) {
    return {
      stdout: "",
      stderr: `ra11y: unknown standard(s): ${missing.join(", ")}. Loaded: ${Object.keys(STANDARD_BY_ID).join(", ")}.\n`,
      exitCode: 2,
    };
  }

  const discovered = await discoverFiles(roots, { excludes: options.exclude });
  if (discovered.length === 0) {
    return {
      stdout: "ra11y: no parseable files found.\n",
      stderr: "",
      exitCode: 0,
    };
  }

  const parsed: ParsedFile[] = [];
  for (const filePath of discovered) {
    const source = await readFile(filePath, "utf8");
    const ast = parseFor(filePath, source);
    if (!ast) continue;
    parsed.push({
      filePath: relative(cwd, filePath),
      source,
      ast,
    });
  }

  const { result, report } = runScan({
    standards: LOADED_STANDARDS,
    rules: BUILTIN_RULES,
    enabled: options.standards,
    files: parsed,
    isTTY: (process.stdout as { isTTY?: boolean }).isTTY === true,
  });

  const formatter = BUILTIN_FORMATTERS[options.format] ?? BUILTIN_FORMATTERS["terminal"];
  if (!formatter) {
    return {
      stdout: "",
      stderr: `ra11y: no formatter available (internal error)\n`,
      exitCode: 2,
    };
  }
  const output = formatter.format(result, report);

  const exitCode = shouldFail(result, options.failOn) ? 1 : 0;
  return { stdout: `${output}\n`, stderr: "", exitCode };
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

function shouldFail(
  result: { violations: readonly { severity: string }[] },
  failOn: CliOptions["failOn"],
): boolean {
  if (failOn === "never") return false;
  for (const v of result.violations) {
    if (failOn === "any") return true;
    if (failOn === "warning" && (v.severity === "error" || v.severity === "warning")) return true;
    if (failOn === "error" && v.severity === "error") return true;
  }
  return false;
}
