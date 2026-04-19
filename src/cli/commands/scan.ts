/**
 * `ra11y scan` — the default command. Discovers files, parses them,
 * runs registered rules against the enabled standards, and prints
 * the formatted output to stdout.
 */

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadConfig } from "../../config/index.ts";
import { parseInlineDisablesDetailed } from "../../config/inline-disables.ts";
import { BUILTIN_PROFILES, resolveProfile } from "../../config/profiles.ts";
import {
  BASELINE_FILENAME,
  buildBaselineFile,
  diffAgainstBaseline,
  loadBaseline,
  writeBaseline,
} from "../../engine/baseline.ts";
import { type ParsedFile, runScan } from "../../engine/scanner.ts";
import { discoverFiles } from "../../input/discover.ts";
import { parseCss, parseHtml, parseTsx } from "../../input/parsers/index.ts";
import { BUILTIN_FORMATTERS } from "../../output/formatters/index.ts";
import {
  buildChecklist,
  buildCoverageReport,
  renderChecklistMarkdown,
} from "../../reports/index.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../../review/index.ts";
import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import type { Ast } from "../../types/ast.ts";
import type { ConformanceProfile, LoadedConfig } from "../../types/config.ts";
import type { Rule } from "../../types/rule.ts";
import type { Standard } from "../../types/standard.ts";
import type { ScanResult } from "../../types/violation.ts";
import { filesChangedSince, stagedFiles } from "../../utils/git.ts";
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

  // Load the user's config file (or fall back to defaults). CLI flags
  // always win over config-file values; we only consult the config to
  // pick up standards, rule settings, and excludes that aren't
  // explicitly set on the command line.
  const fileConfig = await loadConfig({ cwd });

  // Resolve --profile before merging standards/level — when supplied,
  // the profile wins over both and drives the scope downstream reports
  // filter against. Unknown profile names fail fast with exit 2 and a
  // list of valid names; valid names collapse to their {standards,
  // level} tuple here and the rest of the command treats them like the
  // user had typed `--standard <list> --level <L>` directly.
  const profileResolution = resolveProfileFromOptions(options, fileConfig.profiles);
  if (profileResolution.error !== undefined) {
    return { stdout: "", stderr: profileResolution.error, exitCode: 2 };
  }
  const effectiveStandards =
    profileResolution.standards ?? mergeStandards(options.standards, fileConfig);
  const effectiveLevel = profileResolution.level ?? options.level;
  const effectiveExcludes = mergeExcludes(options.exclude, fileConfig);
  const activeRules = filterRulesByConfig(BUILTIN_RULES, fileConfig);
  const profileWarningLine = profileResolution.warning;

  // Validate requested standards before doing any work.
  const missing = effectiveStandards.filter((id) => !(id in STANDARD_BY_ID));
  if (missing.length > 0) {
    return {
      stdout: "",
      stderr: `ra11y: unknown standard(s): ${missing.join(", ")}. Loaded: ${Object.keys(STANDARD_BY_ID).join(", ")}.\n`,
      exitCode: 2,
    };
  }

  // Resolve the root set: positional args first, then fall back to
  // --changed (git staged), then --since (files changed since ref),
  // then the current directory.
  const roots = resolveScanRoots(options, cwd);
  if (roots.length === 0) {
    return {
      stdout: "ra11y: no files to scan.\n",
      stderr: "",
      exitCode: 0,
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
    const { disableMap, declarations } = parseInlineDisablesDetailed(source);
    parsed.push({
      filePath: relative(cwd, filePath),
      source,
      ast,
      disableMap,
      declarations,
    });
  }

  const { result, report } = runScan({
    standards: LOADED_STANDARDS,
    rules: activeRules,
    enabled: effectiveStandards,
    files: parsed,
    finders: BUILTIN_CANDIDATE_FINDERS,
    isTTY: (process.stdout as { isTTY?: boolean }).isTTY === true,
    level: effectiveLevel,
    nativeWrapperElements: fileConfig.nativeWrapperElements,
  });

  // Baseline mode — create, check, or update. Each branch returns
  // early with its own output.
  if (options.baseline !== undefined) {
    return handleBaselineMode(options, cwd, result);
  }

  const formatter = BUILTIN_FORMATTERS[options.format];
  const output = formatter.format(result, report);
  const exitCode = shouldFail(result, options.failOn) ? 1 : 0;

  // When --checklist is passed, append the manual review checklist
  // after the violations report so the user gets one complete document.
  if (options.command === "checklist") {
    const coverage = buildCoverageReport(result, LOADED_STANDARDS, effectiveLevel);
    const checklist = buildChecklist(coverage, LOADED_STANDARDS, report.candidates ?? []);
    const markdown = renderChecklistMarkdown(checklist);
    return {
      stdout: `${output}\n\n---\n\n${markdown}`,
      stderr: profileWarningLine ?? "",
      exitCode,
    };
  }

  return { stdout: `${output}\n`, stderr: profileWarningLine ?? "", exitCode };
}

/**
 * Narrows `options` into a resolved profile — either valid (returns its
 * `standards`/`level`), an error (unknown name → exit 2 + valid-name
 * listing), or a no-op (`--profile` wasn't passed). When the user
 * passed `--profile` alongside `--standard` and/or `--level`, populates
 * the `warning` line the scan command forwards to stderr so the agent
 * can branch on `profile_overrides_standard_level` without inspecting
 * the rest of the response.
 */
function resolveProfileFromOptions(
  options: CliOptions,
  userProfiles: readonly ConformanceProfile[],
): {
  readonly standards?: readonly string[];
  readonly level?: "A" | "AA" | "AAA";
  readonly warning?: string;
  readonly error?: string;
} {
  if (options.profile === undefined) return {};
  const profile = resolveProfile(options.profile, userProfiles);
  if (profile === undefined) {
    const builtin = BUILTIN_PROFILES.map((p) => p.name);
    const user = userProfiles.map((p) => p.name);
    const valid = [...builtin, ...user].join(", ");
    return {
      error: `ra11y: unknown profile \`${options.profile}\`. Valid profiles: ${valid}.\n`,
    };
  }
  const warning = options.profileOverridesExplicit
    ? "ra11y: warnings=profile_overrides_standard_level (profile wins over --standard/--level)\n"
    : undefined;
  return {
    standards: profile.standards,
    ...(profile.level === undefined ? {} : { level: profile.level }),
    ...(warning === undefined ? {} : { warning }),
  };
}

/**
 * Resolves the file/dir roots to scan. Precedence:
 *   1. Positional arguments (highest)
 *   2. --changed → git-staged files
 *   3. --since <ref> → files changed since <ref>
 *   4. cwd (default)
 */
function resolveScanRoots(options: CliOptions, cwd: string): readonly string[] {
  if (options.positionals.length > 0) return options.positionals;
  if (options.changed) return stagedFiles(cwd);
  if (options.since !== undefined && options.since.length > 0) {
    return filesChangedSince(options.since, cwd);
  }
  return [cwd];
}

/**
 * Handles the three --baseline sub-modes. All three exit with a
 * plain-text report instead of going through the normal formatter
 * pipeline — baseline output is operational, not user-facing.
 */
async function handleBaselineMode(
  options: CliOptions,
  cwd: string,
  result: ScanResult,
): Promise<ScanExit> {
  const path = options.baselineFile ?? join(cwd, BASELINE_FILENAME);

  if (options.baseline === "create") {
    const baseline = buildBaselineFile(result);
    await writeBaseline(path, baseline);
    return {
      stdout: `ra11y: wrote baseline with ${baseline.violations.length} entries to ${relative(cwd, path)}\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  if (options.baseline === "update") {
    const baseline = buildBaselineFile(result);
    await writeBaseline(path, baseline);
    return {
      stdout: `ra11y: updated baseline — now ${baseline.violations.length} entries in ${relative(cwd, path)}\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  // check
  const existing = await loadBaseline(path);
  if (!existing) {
    return {
      stdout: "",
      stderr: `ra11y: baseline file not found at ${relative(cwd, path)}. Run \`ra11y --baseline create\` first.\n`,
      exitCode: 2,
    };
  }
  const diff = diffAgainstBaseline(result, existing);
  const lines: string[] = [];
  lines.push(
    `ra11y baseline check: ${diff.grandfathered.length} grandfathered · ${diff.newViolations.length} new · ${diff.resolved.length} resolved`,
  );
  if (diff.newViolations.length > 0) {
    lines.push("");
    lines.push("New violations not in the baseline:");
    for (const v of diff.newViolations) {
      lines.push(
        `  ${v.location.filePath}:${v.location.line}:${v.location.column}  ${v.ruleId}  ${v.message}`,
      );
    }
  }
  if (diff.resolved.length > 0) {
    lines.push("");
    lines.push(
      `${diff.resolved.length} baseline entries are resolved — run \`ra11y --baseline update\` to prune them.`,
    );
  }
  return {
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
    exitCode: diff.newViolations.length > 0 ? 3 : 0,
  };
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
    const r = parseTsx(source, { filePath });
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
