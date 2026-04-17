#!/usr/bin/env bun
/**
 * Scaffolds a new rule end-to-end: rule file, test file, good/bad
 * fixture directories, and an entry in src/rules/index.ts. Takes a
 * skeleton from .claude/skills/add-rule/templates/*.tpl and substitutes
 * placeholders.
 *
 * Usage:
 *   bun scripts/scaffold-rule.ts <domain>/<slug> \
 *     --satisfies wcag22:1.4.13[,wcag21:1.4.13] \
 *     [--severity error|warning|info] \
 *     [--scope node|file] \
 *     [--extensions .tsx,.jsx,.html,.css] \
 *     [--description "One-line summary"] \
 *     [--spec-url https://www.w3.org/TR/WCAG22/#anchor]
 *
 * Writes file skeletons only. Does NOT fill in check() logic, write KB
 * entries, or run verify. The rule-implementer agent fills in logic;
 * /fix-drift regenerates KB.
 *
 * Exits 0 on success, 1 on validation failure or existing-file conflict.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const TEMPLATES = join(ROOT, ".claude", "skills", "add-rule", "templates");
const VALID_DOMAINS = new Set([
  "aria",
  "contrast",
  "document",
  "focus",
  "forms",
  "keyboard",
  "layout",
  "media",
  "motion",
  "navigation",
  "parsing",
  "pointer",
  "semantics",
  "tooltip",
  "orientation",
]);
const VALID_SEVERITIES = new Set(["error", "warning", "info"]);
const VALID_SCOPES = new Set(["node", "file"]);
const DEFAULT_EXTENSIONS = [".tsx", ".jsx", ".html"];
const CRITERION_RE = /^[a-z0-9]+:[\d.a-z]+$/;

interface Args {
  readonly domain: string;
  readonly slug: string;
  readonly satisfies: readonly string[];
  readonly severity: string;
  readonly scope: string;
  readonly extensions: readonly string[];
  readonly description: string;
  readonly specUrl: string;
}

main();

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  ensureClean(args);
  writeRuleFile(args);
  writeTestFile(args);
  writeFixtures(args);
  updateRegistry(args);
  console.log(`✓ scaffolded rule ${args.domain}/${args.slug}`);
  console.log(`  satisfies: ${args.satisfies.join(", ")}`);
  console.log(`  next: fill in check() logic, then run /fix-drift to regenerate kb`);
}

function parseArgs(argv: readonly string[]): Args {
  if (argv.length === 0 || argv[0]?.startsWith("--")) die("missing <domain>/<slug> positional arg");
  const positional = argv[0] ?? "";
  const [domain = "", slug = ""] = positional.split("/");
  const flags = parseFlags(argv.slice(1));
  const satisfies = (flags["satisfies"] ?? "").split(",").filter((s) => s.length > 0);
  const extensions = flags["extensions"]
    ? flags["extensions"].split(",").filter((s) => s.length > 0)
    : DEFAULT_EXTENSIONS;
  const primarySc = satisfies[0] ?? "";
  return {
    domain,
    slug,
    satisfies,
    severity: flags["severity"] ?? "error",
    scope: flags["scope"] ?? "node",
    extensions,
    description: flags["description"] ?? `Rule for ${primarySc || `${domain}/${slug}`}`,
    specUrl: flags["spec-url"] ?? deriveSpecUrl(primarySc),
  };
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) die(`unexpected positional arg after flags: ${arg}`);
    const eq = arg.indexOf("=");
    if (eq === -1) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) die(`--${key} requires a value`);
      out[key] = value;
      i++;
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return out;
}

function validateArgs(args: Args): void {
  if (!args.domain) die("missing domain — expected <domain>/<slug>");
  if (!args.slug) die("missing slug — expected <domain>/<slug>");
  if (!VALID_DOMAINS.has(args.domain))
    die(`unknown domain '${args.domain}'. known: ${[...VALID_DOMAINS].sort().join(", ")}`);
  if (!/^[a-z][a-z0-9-]*$/.test(args.slug))
    die(`slug must be kebab-case (lowercase, hyphen-separated); got '${args.slug}'`);
  if (args.satisfies.length === 0) die("--satisfies is required (e.g. --satisfies wcag22:1.4.13)");
  for (const sc of args.satisfies) {
    if (!CRITERION_RE.test(sc)) die(`invalid criterion id '${sc}' — expected e.g. wcag22:1.4.13`);
  }
  if (!VALID_SEVERITIES.has(args.severity))
    die(`invalid --severity '${args.severity}'; want error|warning|info`);
  if (!VALID_SCOPES.has(args.scope)) die(`invalid --scope '${args.scope}'; want node|file`);
}

function ensureClean(args: Args): void {
  const rulePath = ruleFilePath(args);
  const testPath = testFilePath(args);
  if (existsSync(rulePath)) die(`${rulePath} already exists — refusing to overwrite`);
  if (existsSync(testPath)) die(`${testPath} already exists — refusing to overwrite`);
}

function writeRuleFile(args: Args): void {
  const tpl = readFileSync(join(TEMPLATES, "rule.ts.tpl"), "utf8");
  const localName = slugToLocalName(args.slug);
  const content = substitute(tpl, {
    domain: args.domain,
    slug: args.slug,
    satisfies: args.satisfies.join(", "),
    satisfiesArray: args.satisfies.map((s) => `"${s}"`).join(", "),
    specUrl: args.specUrl,
    normativeQuote: "TODO — paste the normative SC text here as a blockquote.",
    severity: args.severity,
    scope: args.scope,
    nodeTypes: "",
    fileExtensions: args.extensions.map((e) => `"${e}"`).join(", "),
    description: args.description,
    rationale: "TODO — explain why static detection is load-bearing for this SC.",
    goodExample: "TODO — minimal compliant snippet",
    badExample: "TODO — minimal failing snippet",
  });
  const finalContent = content.replace(
    'import { defineRule } from "@/api/plugin";',
    importLineFor(),
  );
  mkdirSync(dirname(ruleFilePath(args)), { recursive: true });
  writeFileSync(ruleFilePath(args), finalContent);
  void localName;
}

function writeTestFile(args: Args): void {
  const tpl = readFileSync(join(TEMPLATES, "test.ts.tpl"), "utf8");
  // File is at tests/unit/rules/<domain>/<slug>.test.ts.
  // helpers lives at tests/helpers/ — 3 levels up.
  // src/rules lives at src/rules/<domain>/ — 4 levels up plus into src.
  const helpersDepth = "../".repeat(3);
  const srcDepth = "../".repeat(4);
  const content = substitute(tpl, {
    domain: args.domain,
    slug: args.slug,
  })
    .replace(
      'import { runRule } from "@/tests/helpers/run-rule";',
      `import { runRule } from "${helpersDepth}helpers/run-rule.ts";`,
    )
    .replace(
      `import { rule } from "@/rules/${args.domain}/${args.slug}";`,
      `import { rule } from "${srcDepth}src/rules/${args.domain}/${args.slug}.ts";`,
    );
  mkdirSync(dirname(testFilePath(args)), { recursive: true });
  writeFileSync(testFilePath(args), content);
}

function writeFixtures(args: Args): void {
  const fixtureDir = `${args.domain}-${args.slug}`;
  const goodDir = join(ROOT, "tests", "fixtures", "good", fixtureDir);
  const badDir = join(ROOT, "tests", "fixtures", "bad", fixtureDir);
  mkdirSync(goodDir, { recursive: true });
  mkdirSync(badDir, { recursive: true });
  const tpl = readFileSync(join(TEMPLATES, "fixture.tsx.tpl"), "utf8");
  const goodContent = substitute(tpl, {
    domain: args.domain,
    slug: args.slug,
    scenario: `Good: compliant ${args.domain}/${args.slug} scenario`,
  });
  const badContent = substitute(tpl, {
    domain: args.domain,
    slug: args.slug,
    scenario: `Bad: failing ${args.domain}/${args.slug} scenario`,
  });
  writeFileSync(join(goodDir, "placeholder.tsx"), goodContent);
  writeFileSync(join(badDir, "placeholder.tsx"), badContent);
}

function updateRegistry(args: Args): void {
  const registryPath = join(ROOT, "src", "rules", "index.ts");
  const source = readFileSync(registryPath, "utf8");
  const localName = slugToLocalName(args.slug);
  const importLine = `import { rule as ${localName} } from "./${args.domain}/${args.slug}.ts";`;
  const updated = insertIntoRegistry(source, localName, importLine);
  writeFileSync(registryPath, updated);
}

function insertIntoRegistry(source: string, localName: string, importLine: string): string {
  const lines = source.split("\n");
  const importRE = /^import \{ rule as (\w+) \} from/;
  const exportEntryRE = /^\s+(\w+),?\s*$/;

  const insertSorted = (range: { start: number; end: number }, newLine: string): void => {
    const nameRE = /\b(\w+)\b/;
    const getName = (line: string): string => nameRE.exec(line)?.[1] ?? "";
    const needle = getName(newLine);
    let insertAt = range.end;
    for (let i = range.start; i < range.end; i++) {
      const existing = getName(lines[i] ?? "");
      if (existing && needle < existing) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, newLine);
  };

  const importRange = findContiguousRange(lines, (l) => importRE.test(l));
  if (!importRange) throw new Error("could not locate import block in src/rules/index.ts");
  insertSorted(importRange, importLine);

  const afterImports = lines.findIndex((l) => /export const BUILTIN_RULES/.test(l));
  if (afterImports === -1) throw new Error("could not locate BUILTIN_RULES array");
  const builtinRange = findBracedRange(lines, afterImports, "[", "]");
  if (!builtinRange) throw new Error("could not locate BUILTIN_RULES array body");
  insertSorted({ start: builtinRange.start + 1, end: builtinRange.end }, `  ${localName},`);

  const exportIndex = lines.findIndex((l) => /^export \{\s*$/.test(l));
  if (exportIndex === -1) throw new Error("could not locate named export block");
  const exportRange = findBracedRange(lines, exportIndex, "{", "}");
  if (!exportRange) throw new Error("could not locate named export block body");
  insertSorted(
    {
      start: exportRange.start + 1,
      end: exportRange.end,
    },
    `  ${localName},`,
  );

  void exportEntryRE;
  return lines.join("\n");
}

function findContiguousRange(
  lines: readonly string[],
  predicate: (line: string) => boolean,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (predicate(line)) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      return { start, end: i };
    }
  }
  if (start === -1) return null;
  return { start, end: lines.length };
}

function findBracedRange(
  lines: readonly string[],
  from: number,
  open: string,
  close: string,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = from; i < lines.length; i++) {
    if ((lines[i] ?? "").includes(open)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === close || (lines[i] ?? "").trim() === `${close};`) {
      return { start, end: i };
    }
  }
  return null;
}

function ruleFilePath(args: Args): string {
  return join(ROOT, "src", "rules", args.domain, `${args.slug}.ts`);
}

function testFilePath(args: Args): string {
  return join(ROOT, "tests", "unit", "rules", args.domain, `${args.slug}.test.ts`);
}

function slugToLocalName(slug: string): string {
  const parts = slug.split("-");
  return parts.map((part, i) => (i === 0 ? part : part[0]?.toUpperCase() + part.slice(1))).join("");
}

function importLineFor(): string {
  // Rules live at src/rules/<domain>/<slug>.ts; api is at src/api — two levels up.
  return 'import { defineRule } from "../../api/plugin.ts";';
}

function deriveSpecUrl(criterion: string): string {
  if (!criterion) return "https://www.w3.org/TR/WCAG22/";
  const [standard = "", sc = ""] = criterion.split(":");
  if (standard === "wcag22") return `https://www.w3.org/TR/WCAG22/#${scToAnchor(sc)}`;
  if (standard === "wcag21") return `https://www.w3.org/TR/WCAG21/#${scToAnchor(sc)}`;
  return "https://www.w3.org/TR/WCAG22/";
}

function scToAnchor(sc: string): string {
  return sc.replace(/\./g, "-");
}

function substitute(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function die(msg: string): never {
  console.error(`scaffold-rule: ${msg}`);
  process.exit(1);
}
