/**
 * CLI argument spec. Single source of truth for what flags the
 * binary accepts and how they bind to internal options. The
 * in-house parser in src/utils/args.ts does the string-level work;
 * this module shapes the result into a typed CliOptions object.
 */

import { parseArgs } from "../utils/args.ts";

export interface CliOptions {
  readonly command:
    | "scan"
    | "list-rules"
    | "list-standards"
    | "explain"
    | "coverage"
    | "checklist"
    | "vpat"
    | "certification"
    | "help"
    | "version";
  readonly positionals: readonly string[];
  readonly format: "terminal" | "plain" | "json" | "sarif" | "junit" | "markdown";
  readonly standards: readonly string[];
  readonly level: "A" | "AA" | "AAA";
  readonly exclude: readonly string[];
  readonly failOn: "error" | "warning" | "any" | "never";
  readonly ruleId?: string;
  readonly noColor: boolean;
  readonly verbose: boolean;
  readonly debug: boolean;
  readonly quiet: boolean;
}

/**
 * Typed view of the raw parseArgs output. Bridges the generic
 * parser (Record<string, ...>) to dot-accessible named fields so
 * TS's `noPropertyAccessFromIndexSignature` and Biome's
 * `useLiteralKeys` rules both apply cleanly. Keys with hyphens
 * (`no-color`, `list-rules`, etc.) can't be TypeScript identifiers,
 * so we camelCase them here even though the CLI wire name has a
 * hyphen — the translation happens once at the boundary.
 */
interface RawCliOptions {
  // Every field is `T | undefined` rather than just `T?` because
  // translate() builds the object programmatically with defaults,
  // and `exactOptionalPropertyTypes: true` forbids assigning
  // explicit undefined to a `?:` field. The semantics are the
  // same for readers — dot access either returns the value or
  // undefined — but the assignment side is explicit.
  readonly help: boolean | undefined;
  readonly version: boolean | undefined;
  readonly verbose: boolean | undefined;
  readonly quiet: boolean | undefined;
  readonly debug: boolean | undefined;
  readonly noColor: boolean | undefined;
  readonly listRules: boolean | undefined;
  readonly listStandards: boolean | undefined;
  readonly coverage: boolean | undefined;
  readonly checklist: boolean | undefined;
  readonly vpat: boolean | undefined;
  readonly certification: boolean | undefined;
  readonly explain: string | undefined;
  readonly format: string | undefined;
  readonly standard: string | undefined;
  readonly level: string | undefined;
  readonly failOn: string | undefined;
  readonly exclude: string | readonly string[] | undefined;
  readonly ignore: string | readonly string[] | undefined;
}

const FLAGS = [
  "help",
  "version",
  "verbose",
  "quiet",
  "debug",
  "no-color",
  "list-rules",
  "list-standards",
  "coverage",
  "checklist",
  "vpat",
  "certification",
];

const ALIASES: Readonly<Record<string, string>> = {
  f: "format",
  o: "output",
  h: "help",
  v: "version",
};

const REPEATABLE = ["exclude", "ignore"];

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const parsed = parseArgs(argv, { flags: FLAGS, aliases: ALIASES, repeatable: REPEATABLE });
  const opts = translate(parsed.options);

  if (opts.help === true) return baseOpts(parsed.positionals, "help");
  if (opts.version === true) return baseOpts(parsed.positionals, "version");
  if (opts.listRules === true) return baseOpts(parsed.positionals, "list-rules");
  if (opts.listStandards === true) return baseOpts(parsed.positionals, "list-standards");
  if (opts.coverage === true) return baseOpts(parsed.positionals, "coverage", opts);
  if (opts.checklist === true) return baseOpts(parsed.positionals, "checklist", opts);
  if (opts.vpat === true) return baseOpts(parsed.positionals, "vpat", opts);
  if (opts.certification === true) return baseOpts(parsed.positionals, "certification", opts);

  if (typeof opts.explain === "string") {
    return { ...baseOpts(parsed.positionals, "explain"), ruleId: opts.explain };
  }

  return baseOpts(parsed.positionals, "scan", opts);
}

/**
 * Translates the generic argv map into a typed RawCliOptions. The
 * mapping is 1:1 except hyphenated keys become camelCase and
 * `fail-on` collapses into `failOn`. The resulting object is a
 * plain interface (not an index signature) so downstream dot
 * access is both correct and lint-clean.
 */
function translate(
  raw: Readonly<Record<string, string | boolean | readonly string[]>>,
): RawCliOptions {
  return {
    help: boolAt(raw, "help"),
    version: boolAt(raw, "version"),
    verbose: boolAt(raw, "verbose"),
    quiet: boolAt(raw, "quiet"),
    debug: boolAt(raw, "debug"),
    noColor: boolAt(raw, "no-color"),
    listRules: boolAt(raw, "list-rules"),
    listStandards: boolAt(raw, "list-standards"),
    coverage: boolAt(raw, "coverage"),
    checklist: boolAt(raw, "checklist"),
    vpat: boolAt(raw, "vpat"),
    certification: boolAt(raw, "certification"),
    explain: stringAt(raw, "explain"),
    format: stringAt(raw, "format"),
    standard: stringAt(raw, "standard"),
    level: stringAt(raw, "level"),
    failOn: stringAt(raw, "fail-on"),
    exclude: listAt(raw, "exclude"),
    ignore: listAt(raw, "ignore"),
  };
}

function boolAt(
  raw: Readonly<Record<string, string | boolean | readonly string[]>>,
  key: string,
): boolean | undefined {
  const v = raw[key];
  return typeof v === "boolean" ? v : undefined;
}

function stringAt(
  raw: Readonly<Record<string, string | boolean | readonly string[]>>,
  key: string,
): string | undefined {
  const v = raw[key];
  return typeof v === "string" ? v : undefined;
}

function listAt(
  raw: Readonly<Record<string, string | boolean | readonly string[]>>,
  key: string,
): string | readonly string[] | undefined {
  const v = raw[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v;
  return undefined;
}

function baseOpts(
  positionals: readonly string[],
  command: CliOptions["command"],
  raw?: RawCliOptions,
): CliOptions {
  return {
    command,
    positionals,
    format: normalizeFormat(raw?.format),
    standards: normalizeStandards(raw?.standard),
    level: normalizeLevel(raw?.level),
    exclude: normalizeList(raw?.exclude).concat(normalizeList(raw?.ignore)),
    failOn: normalizeFailOn(raw?.failOn),
    noColor: raw?.noColor === true,
    verbose: raw?.verbose === true,
    debug: raw?.debug === true,
    quiet: raw?.quiet === true,
  };
}

function normalizeFormat(value: string | undefined): CliOptions["format"] {
  if (value === "plain") return "plain";
  if (value === "json") return "json";
  if (value === "sarif") return "sarif";
  if (value === "junit") return "junit";
  if (value === "markdown") return "markdown";
  return "terminal";
}

function normalizeStandards(value: string | undefined): readonly string[] {
  if (typeof value !== "string") return ["wcag22"];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeLevel(value: string | undefined): CliOptions["level"] {
  if (value === "A") return "A";
  if (value === "AAA") return "AAA";
  return "AA";
}

function normalizeFailOn(value: string | undefined): CliOptions["failOn"] {
  if (value === "warning" || value === "any" || value === "never") return value;
  return "error";
}

function normalizeList(value: string | readonly string[] | undefined): readonly string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}
