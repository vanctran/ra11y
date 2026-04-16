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
 *   - `templateDirectiveHandling`: plain-English summary of *what* the
 *     scanner does with those directives, so agents don't have to guess
 *     whether a Jinja-laced file was partially analyzed or skipped.
 *   - `parseErrorFileCount`: files where the parser couldn't produce a
 *     clean AST. Rules still ran on the partial tree, but may have
 *     missed violations below the parse-error point.
 *   - `hints`: actionable suggestions derived from the above counts —
 *     e.g., "add these 8 design-system wrappers to nativeWrappers" when
 *     `opaqueCustomComponents` is high, or "post-compile CSS likely not
 *     in scan path" when CSS coverage is thin vs HTML/JSX. Each hint
 *     is a single sentence an agent can act on in one tool call.
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
    templateDirectiveHandling?: string;
    parseErrorFileCount?: number;
    parseErrorFiles?: readonly string[];
    rulesByExtension?: Readonly<Record<string, readonly string[]>>;
    hints?: readonly string[];
  } = {};
  if (acc.opaqueComponents.size > 0) {
    coverage.opaqueCustomComponents = acc.opaqueComponents.size;
    if (verbose) coverage.opaqueCustomComponentNames = [...acc.opaqueComponents].sort();
  }
  if (acc.templateEngines.size > 0) {
    coverage.templateDirectivesFound = [...acc.templateEngines].sort();
    coverage.templateDirectiveHandling = describeTemplateDirectiveHandling(acc.templateEngines);
  }
  if (acc.parseErrorFiles.length > 0) {
    coverage.parseErrorFileCount = acc.parseErrorFiles.length;
    if (verbose) coverage.parseErrorFiles = [...acc.parseErrorFiles].sort();
  }
  if (verbose) {
    const byExt = rulesByExtension(files, activeRules);
    if (Object.keys(byExt).length > 0) coverage.rulesByExtension = byExt;
  }
  const hints = buildHints(files, acc);
  if (hints.length > 0) coverage.hints = hints;
  return Object.keys(coverage).length > 0 ? { analysisCoverage: coverage } : {};
}

/**
 * Threshold for surfacing the nativeWrappers hint. Below this the
 * opaque count is usually one-off components rather than a design
 * system that warrants wiring into config.
 */
const OPAQUE_COMPONENT_HINT_MIN = 8;

/**
 * Minimum JSX-or-HTML count before we consider a low CSS-scan count
 * noteworthy. A truly-static site with one CSS file doesn't need a
 * warning; a React codebase with 200 TSX and 2 CSS files almost
 * certainly has post-compile Tailwind/CSS-in-JS that isn't being
 * scanned.
 */
const MARKUP_FILES_FOR_CSS_HINT_MIN = 30;

/** CSS-to-markup ratio below which the thin-CSS hint fires. */
const CSS_TO_MARKUP_THIN_RATIO = 0.05;

function buildHints(files: readonly ParsedFile[], acc: CoverageAccumulator): readonly string[] {
  const hints: string[] = [];
  const opaqueCount = acc.opaqueComponents.size;
  if (opaqueCount >= OPAQUE_COMPONENT_HINT_MIN) {
    const examples = [...acc.opaqueComponents].sort().slice(0, 3).join(", ");
    hints.push(
      `${opaqueCount} PascalCase components are opaque to the scanner (e.g. ${examples}). ` +
        `Rules needing the underlying element (button-name, alt-text, link-purpose) skip these. ` +
        `Wire common wrappers via \`nativeWrappers\` in ra11y.config.ts — e.g. ` +
        `{ Button: "button", Link: "a", Image: "img" } — to unlock analysis. ` +
        `Call \`detect_native_wrappers\` for a suggested mapping based on this codebase.`,
    );
  }
  const counts = countByCategory(files);
  const markupFiles = counts.jsx + counts.html;
  if (
    markupFiles >= MARKUP_FILES_FOR_CSS_HINT_MIN &&
    counts.css <= Math.max(1, Math.floor(markupFiles * CSS_TO_MARKUP_THIN_RATIO))
  ) {
    hints.push(
      `Only ${counts.css} CSS file(s) scanned vs ${markupFiles} JSX/HTML file(s). ` +
        `Post-compile output (Tailwind, CSS-in-JS, SCSS) isn't parsed — color-contrast ` +
        `and focus-visible coverage may be undercounted. Build the site and point ` +
        `\`scan\` at the emitted .css, or scan the Tailwind source config alongside JSX.`,
    );
  }
  return hints;
}

interface ParsedFileCounts {
  readonly jsx: number;
  readonly html: number;
  readonly css: number;
}

function countByCategory(files: readonly ParsedFile[]): ParsedFileCounts {
  let jsx = 0;
  let html = 0;
  let css = 0;
  for (const f of files) {
    if (f.ast.language === "tsx" || f.ast.language === "jsx") jsx += 1;
    else if (f.ast.language === "html") html += 1;
    else if (f.ast.language === "css") css += 1;
  }
  return { jsx, html, css };
}

/**
 * Explains what the HTML parser does with the template directives we
 * detected. The parser treats `{% ... %}` and `{{ ... }}` as literal
 * text, so attribute values and text content containing directives are
 * parsed verbatim; rules evaluate against the template source, not the
 * rendered output. Calling this out explicitly replaces the silent
 * "templateDirectivesFound" signal, which told the agent *that* we saw
 * directives but not how we handled them.
 */
function describeTemplateDirectiveHandling(engines: ReadonlySet<string>): string {
  const list = [...engines].sort().join(", ");
  return (
    `${list} directives are parsed as literal HTML text — the rendered output is not ` +
    "reconstructed. Rules run against the template source, so attributes like " +
    '`class="{% if x %}foo{% endif %}"` are evaluated as the raw string containing ' +
    "the directive. Cross-template `extends`/`include` relationships are not resolved. " +
    "Verify findings in files flagged with directives by reading the rendered output " +
    "rather than the template."
  );
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
