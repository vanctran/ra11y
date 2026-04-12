/**
 * `ra11y scan` — the default command. Discovers files, parses them,
 * runs registered rules against the enabled standards, and prints
 * the formatted output to stdout.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { loadConfig, parseInlineDisables } from "../../config/index.ts";
import { type ParsedFile, runScan } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseCss, parseHtml, parseTsx } from "../../input/parsers/index.ts";
import { BUILTIN_FORMATTERS } from "../../output/formatters/index.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import type { Ast } from "../../types/ast.ts";
import type { LoadedConfig } from "../../types/config.ts";
import type { Rule } from "../../types/rule.ts";
import type { Standard } from "../../types/standard.ts";
import type { CliOptions } from "../args.ts";

const LOADED_STANDARDS: readonly Standard[] = BUILTIN_STANDARDS;

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

  // Load the user's config file (or fall back to defaults). CLI flags
  // always win over config-file values; we only consult the config to
  // pick up standards, rule settings, and excludes that aren't
  // explicitly set on the command line.
  const fileConfig = await loadConfig({ cwd });
  const effectiveStandards = mergeStandards(options.standards, fileConfig);
  const effectiveExcludes = mergeExcludes(options.exclude, fileConfig);
  const activeRules = filterRulesByConfig(BUILTIN_RULES, fileConfig);

  // Validate requested standards before doing any work.
  const missing = effectiveStandards.filter((id) => !(id in STANDARD_BY_ID));
  if (missing.length > 0) {
    return {
      stdout: "",
      stderr: `ra11y: unknown standard(s): ${missing.join(", ")}. Loaded: ${Object.keys(STANDARD_BY_ID).join(", ")}.\n`,
      exitCode: 2,
    };
  }

  const discovered = await discoverFiles(roots, { excludes: effectiveExcludes });
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
      disableMap: parseInlineDisables(source),
    });
  }

  const { result, report } = runScan({
    standards: LOADED_STANDARDS,
    rules: activeRules,
    enabled: effectiveStandards,
    files: parsed,
    isTTY: (process.stdout as { isTTY?: boolean }).isTTY === true,
  });

  // options.format is the CliOptions union "terminal" | "plain" | "json",
  // which exactly matches BuiltinFormatters keys, so indexing is total
  // and no fallback is needed.
  const formatter = BUILTIN_FORMATTERS[options.format];
  const output = formatter.format(result, report);

  const exitCode = shouldFail(result, options.failOn) ? 1 : 0;
  return { stdout: `${output}\n`, stderr: "", exitCode };
}

function parseFor(filePath: string, source: string): Ast | null {
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
    const r = parseHtml(source);
    return { language: "html", root: r.root, errors: r.errors };
  }
  if (filePath.endsWith(".css")) {
    const r = parseCss(source);
    return { language: "css", root: r.root, errors: r.errors };
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

/**
 * CLI standards win when the user specified them explicitly. The
 * `options.standards` default is `["wcag22"]` — which is also the
 * config default — so we can't easily distinguish "user wrote
 * --standard wcag22" from "user wrote nothing". For v0.0.x, the CLI
 * value always wins; when config support stabilizes the args parser
 * will track explicit vs. default so the merge is unambiguous.
 */
function mergeStandards(
  cliStandards: readonly string[],
  fileConfig: LoadedConfig,
): readonly string[] {
  // Default CLI value is ["wcag22"]. If config specifies something
  // different, prefer config. Otherwise stick with CLI.
  const cliIsDefault = cliStandards.length === 1 && cliStandards[0] === "wcag22";
  if (cliIsDefault && fileConfig.standards.length > 0) return fileConfig.standards;
  return cliStandards;
}

function mergeExcludes(
  cliExcludes: readonly string[],
  fileConfig: LoadedConfig,
): readonly string[] {
  return [...cliExcludes, ...fileConfig.exclude];
}

/**
 * Applies config.rules to the built-in rule list, dropping any rule
 * whose setting is "off" and leaving the rest for execution. Severity
 * overrides (`"warn"`, `"error"`) are applied via a wrapper object
 * that preserves the original rule identity.
 */
function filterRulesByConfig(rules: readonly Rule[], fileConfig: LoadedConfig): readonly Rule[] {
  const settings = fileConfig.rules;
  return rules
    .filter((r) => settings[r.id] !== "off")
    .map((r) => applySeverityOverride(r, settings[r.id]));
}

function applySeverityOverride(rule: Rule, setting: unknown): Rule {
  if (setting === "error" || setting === "warning" || setting === "info") {
    return { ...rule, severity: setting };
  }
  return rule;
}
