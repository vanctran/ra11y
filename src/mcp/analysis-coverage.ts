/**
 * Honest telemetry about what static analysis couldn't reach. Not a
 * heuristic — each field counts or names a structural gap directly:
 *
 *   - `opaqueCustomComponents`: distinct PascalCase JSX tags we saw but
 *     don't look inside. Rules that need to verify an underlying
 *     element (e.g. "does this button have an accessible name?") can't
 *     see through custom components except via `nativeWrappers`.
 *   - `templateDirectivesFound`: template-engine syntax (Jinja, Liquid,
 *     Handlebars) we detected in scanned HTML. Cross-template `extends`
 *     / `include` relationships are not resolved — a fragment with
 *     "view above" may render inside a parent that changes the meaning.
 *   - `parseErrorFileCount`: files where the parser couldn't produce a
 *     clean AST. Rules still ran on the partial tree, but may have
 *     missed violations below the parse-error point.
 *
 * Under `verboseMeta`, the counts are joined by their underlying arrays
 * (`parseErrorFiles`, `opaqueCustomComponentNames`) plus `rulesByExtension`
 * so the agent can verify which rules ran on which file types. Fields
 * omitted when they'd be empty, so clean projects stay terse.
 */

import { walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import type { Rule } from "../types/rule.ts";

interface CoverageAccumulator {
  readonly opaqueComponents: Set<string>;
  readonly templateEngines: Set<string>;
  readonly parseErrorFiles: string[];
}

export function buildAnalysisCoverage(
  files: readonly ParsedFile[],
  wrappers: readonly string[],
  activeRules: readonly Rule[],
  verbose: boolean,
): { analysisCoverage?: Record<string, unknown> } {
  const acc: CoverageAccumulator = {
    opaqueComponents: new Set(),
    templateEngines: new Set(),
    parseErrorFiles: [],
  };
  const wrapperSet = new Set(wrappers);
  for (const file of files) accumulateCoverageForFile(file, wrapperSet, acc);

  const coverage: {
    opaqueCustomComponents?: number;
    opaqueCustomComponentNames?: readonly string[];
    templateDirectivesFound?: readonly string[];
    parseErrorFileCount?: number;
    parseErrorFiles?: readonly string[];
    rulesByExtension?: Readonly<Record<string, readonly string[]>>;
  } = {};
  if (acc.opaqueComponents.size > 0) {
    coverage.opaqueCustomComponents = acc.opaqueComponents.size;
    if (verbose) coverage.opaqueCustomComponentNames = [...acc.opaqueComponents].sort();
  }
  if (acc.templateEngines.size > 0) {
    coverage.templateDirectivesFound = [...acc.templateEngines].sort();
  }
  if (acc.parseErrorFiles.length > 0) {
    coverage.parseErrorFileCount = acc.parseErrorFiles.length;
    if (verbose) coverage.parseErrorFiles = [...acc.parseErrorFiles].sort();
  }
  if (verbose) {
    const byExt = rulesByExtension(files, activeRules);
    if (Object.keys(byExt).length > 0) coverage.rulesByExtension = byExt;
  }
  return Object.keys(coverage).length > 0 ? { analysisCoverage: coverage } : {};
}

/**
 * For each file extension actually seen in this scan, lists the active
 * rule IDs that evaluated files with that extension. Mirrors the gate in
 * rule-runner.ts `applies()` — a rule with no `fileExtensions` constraint
 * runs on every extension; otherwise only on declared ones.
 */
function rulesByExtension(
  files: readonly ParsedFile[],
  activeRules: readonly Rule[],
): Record<string, readonly string[]> {
  const extsSeen = new Set<string>();
  for (const f of files) {
    const dot = f.filePath.lastIndexOf(".");
    if (dot !== -1) extsSeen.add(f.filePath.slice(dot).toLowerCase());
  }
  const out: Record<string, readonly string[]> = {};
  for (const ext of [...extsSeen].sort()) {
    const ids: string[] = [];
    for (const r of activeRules) {
      const declared = r.appliesTo?.fileExtensions;
      if (!declared || declared.length === 0) {
        ids.push(r.id);
        continue;
      }
      if (declared.some((d) => d.toLowerCase() === ext)) ids.push(r.id);
    }
    out[ext] = ids.sort();
  }
  return out;
}

function accumulateCoverageForFile(
  file: ParsedFile,
  wrapperSet: ReadonlySet<string>,
  acc: CoverageAccumulator,
): void {
  if (file.ast.errors.length > 0) acc.parseErrorFiles.push(file.filePath);
  if (file.ast.language === "html") {
    detectTemplateEngines(file.source, acc.templateEngines);
    return;
  }
  if (file.ast.language === "css") return;
  for (const el of walkJsxElements(file.ast.root)) {
    if (/^[A-Z]/.test(el.tagName) && !wrapperSet.has(el.tagName)) {
      acc.opaqueComponents.add(el.tagName);
    }
  }
}

function detectTemplateEngines(source: string, into: Set<string>): void {
  // Cheap structural probes. Not trying to distinguish dialects
  // precisely — the signal "this file isn't plain HTML" is what the
  // agent needs to know cross-file reasoning is limited.
  if (/\{%\s*(?:extends|include|block|if|for|set)\b/.test(source)) into.add("jinja-or-liquid");
  if (/\{\{[^}]+\}\}/.test(source) && !into.has("jinja-or-liquid"))
    into.add("handlebars-or-mustache");
  if (/<%[=-]?[\s\S]*?%>/.test(source)) into.add("erb-or-ejs");
}
