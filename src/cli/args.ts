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
  readonly format: "terminal" | "plain" | "json";
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
  const opts = parsed.options;

  if (opts["help"] === true) return baseOpts(parsed.positionals, "help");
  if (opts["version"] === true) return baseOpts(parsed.positionals, "version");
  if (opts["list-rules"] === true) return baseOpts(parsed.positionals, "list-rules");
  if (opts["list-standards"] === true) return baseOpts(parsed.positionals, "list-standards");
  if (opts["coverage"] === true) return baseOpts(parsed.positionals, "coverage", opts);
  if (opts["checklist"] === true) return baseOpts(parsed.positionals, "checklist", opts);
  if (opts["vpat"] === true) return baseOpts(parsed.positionals, "vpat", opts);
  if (opts["certification"] === true) return baseOpts(parsed.positionals, "certification", opts);

  const explainTarget = opts["explain"];
  if (typeof explainTarget === "string") {
    return { ...baseOpts(parsed.positionals, "explain"), ruleId: explainTarget };
  }

  return baseOpts(parsed.positionals, "scan", opts);
}

function baseOpts(
  positionals: readonly string[],
  command: CliOptions["command"],
  raw: Readonly<Record<string, string | boolean | string[]>> = {},
): CliOptions {
  const format = normalizeFormat(raw["format"]);
  const standards = normalizeStandards(raw["standard"]);
  const level = normalizeLevel(raw["level"]);
  const failOn = normalizeFailOn(raw["fail-on"]);
  const exclude = normalizeList(raw["exclude"]).concat(normalizeList(raw["ignore"]));

  return {
    command,
    positionals,
    format,
    standards,
    level,
    exclude,
    failOn,
    noColor: raw["no-color"] === true,
    verbose: raw["verbose"] === true,
    debug: raw["debug"] === true,
    quiet: raw["quiet"] === true,
  };
}

function normalizeFormat(value: unknown): CliOptions["format"] {
  if (value === "plain") return "plain";
  if (value === "json") return "json";
  return "terminal";
}

function normalizeStandards(value: unknown): readonly string[] {
  if (typeof value !== "string") return ["wcag22"];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeLevel(value: unknown): CliOptions["level"] {
  if (value === "A") return "A";
  if (value === "AAA") return "AAA";
  return "AA";
}

function normalizeFailOn(value: unknown): CliOptions["failOn"] {
  if (value === "warning" || value === "any" || value === "never") return value;
  return "error";
}

function normalizeList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}
