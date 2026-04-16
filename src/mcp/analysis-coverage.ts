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

interface OpaqueComponentUsage {
  callSites: number;
  /**
   * True once ANY call site of this component has an attribute that
   * signals DOM interactivity (onClick, onKeyDown, role, tabIndex,
   * href, to, onSubmit, ...) OR uses `{...spread}` props which static
   * analysis cannot introspect. Wrapper candidates — the components
   * users most want surfaced by `nativeWrappers` onboarding — have
   * this true somewhere. Framework primitives like react-router's
   * `<Route>` stay false and drop out of the top-N ranking.
   */
  interactive: boolean;
}

interface CoverageAccumulator {
  /**
   * Map of PascalCase tag name → call-site count + interactive flag.
   * Count drives the top-N ranking so the coverage output can surface
   * the hot-path wrappers without the agent flipping `verboseMeta` and
   * counting manually. The interactive flag filters the ranking to
   * components actually used in an interactive context — non-DOM
   * framework primitives (Route, Provider, Suspense, ErrorBoundary)
   * never appear with interactive attrs and so drop out structurally,
   * without a hardcoded carve-out list.
   */
  readonly opaqueComponents: Map<string, OpaqueComponentUsage>;
  readonly templateEngines: Set<string>;
  readonly parseErrorFiles: string[];
}

/**
 * Attribute names that signal the surrounding element is used in an
 * interactive context. A single match on any call site flips the
 * component's `interactive` flag — so a component used mostly
 * declaratively but occasionally with `onClick` still surfaces as a
 * wrapper candidate. Over-includes on purpose: the goal is to keep real
 * wrappers ranked, not to perfectly classify. `{...spread}` props also
 * trip the flag because we cannot see what the spread expands to.
 */
const INTERACTIVE_ATTRS: ReadonlySet<string> = new Set([
  "onClick",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onTouchStart",
  "onTouchEnd",
  "onSubmit",
  "onChange",
  "onInput",
  "onFocus",
  "onBlur",
  "role",
  "tabIndex",
  "href",
  "to",
  "formAction",
  "aria-pressed",
  "aria-expanded",
  "aria-haspopup",
  "aria-checked",
  "aria-selected",
  "aria-disabled",
  "disabled",
]);

function elementIsInteractive(el: {
  readonly attributes: readonly { readonly name: string }[];
  readonly hasSpreadProps: boolean;
}): boolean {
  if (el.hasSpreadProps) return true;
  for (const attr of el.attributes) {
    if (INTERACTIVE_ATTRS.has(attr.name)) return true;
  }
  return false;
}

/**
 * Default cap on how many top-by-count opaque components we surface
 * inline. Five is enough to identify the design system's hot paths
 * without bloating the response. Under `verboseMeta: true` the cap is
 * removed and the full ranked list (with call-site counts) is
 * returned, because the agent triaging wrapper coverage needs every
 * candidate, not just the head.
 */
const OPAQUE_COMPONENT_TOP_N = 5;

export function buildAnalysisCoverage(
  files: readonly ParsedFile[],
  wrappers: readonly string[],
  activeRules: readonly Rule[],
  verbose: boolean,
): { analysisCoverage?: Record<string, unknown> } {
  const acc: CoverageAccumulator = {
    opaqueComponents: new Map(),
    templateEngines: new Set(),
    parseErrorFiles: [],
  };
  const wrapperSet = new Set(wrappers);
  for (const file of files) accumulateCoverageForFile(file, wrapperSet, acc);

  const coverage: {
    opaqueCustomComponents?: number;
    opaqueCustomComponentsTop?: readonly { readonly name: string; readonly callSites: number }[];
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
    const ranked = rankOpaqueByCallSites(acc.opaqueComponents);
    coverage.opaqueCustomComponentsTop = verbose ? ranked : ranked.slice(0, OPAQUE_COMPONENT_TOP_N);
    if (verbose) coverage.opaqueCustomComponentNames = [...acc.opaqueComponents.keys()].sort();
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

/**
 * Ranks opaque components by raw call-site count (desc), breaking ties
 * alphabetically so the output is deterministic across runs. Exposed
 * inline via `opaqueCustomComponentsTop` so an agent prioritizing which
 * wrappers to register doesn't need a second `verboseMeta: true` round
 * trip just to read counts.
 */
function rankOpaqueByCallSites(
  opaque: ReadonlyMap<string, OpaqueComponentUsage>,
): readonly { readonly name: string; readonly callSites: number }[] {
  return [...opaque.entries()]
    .filter(([, usage]) => usage.interactive)
    .sort(([aName, a], [bName, b]) => b.callSites - a.callSites || aName.localeCompare(bName))
    .map(([name, usage]) => ({ name, callSites: usage.callSites }));
}

function buildHints(files: readonly ParsedFile[], acc: CoverageAccumulator): readonly string[] {
  const hints: string[] = [];
  const opaqueCount = acc.opaqueComponents.size;
  if (opaqueCount >= OPAQUE_COMPONENT_HINT_MIN) {
    const examples = rankOpaqueByCallSites(acc.opaqueComponents)
      .slice(0, 3)
      .map((e) => `${e.name} (${e.callSites} call sites)`)
      .join(", ");
    hints.push(
      `${opaqueCount} PascalCase components are opaque to the scanner (top: ${examples}). ` +
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
    hints.push(buildCssThinHint(files, counts.css, markupFiles));
  }
  return hints;
}

/**
 * Builds the thin-CSS-coverage hint, strengthened with a Tailwind-
 * specific follow-up when Tailwind usage is detected. On a Tailwind
 * codebase the only realistic way to get contrast/focus-visible
 * coverage is to run the build and point scan_project at the emitted
 * CSS — naming the exact `additionalPaths` argument saves the agent
 * a discovery round trip.
 */
function buildCssThinHint(files: readonly ParsedFile[], css: number, markup: number): string {
  const base =
    `Only ${css} CSS file(s) scanned vs ${markup} JSX/HTML file(s). ` +
    "Post-compile output (Tailwind, CSS-in-JS, SCSS) isn't parsed — color-contrast " +
    "and focus-visible coverage may be undercounted.";
  if (hasTailwindSignal(files)) {
    return (
      `${base} Tailwind usage detected: run the build, then re-run scan_project with ` +
      '`additionalPaths: ["dist/assets"]` (or wherever your bundler emits CSS) to ' +
      "include the generated stylesheet. `additionalPaths` bypasses `.gitignore` and " +
      "the default build-dir skips for the paths you list."
    );
  }
  return `${base} Build the site and point \`scan\` at the emitted .css, or scan the Tailwind source config alongside JSX.`;
}

/**
 * Cheap Tailwind detector: a `class`/`className` attribute anywhere in
 * the scanned JSX whose value contains two or more tokens with the
 * `prefix-value` shape characteristic of Tailwind utilities. We
 * deliberately don't parse tailwind.config.*; that would require
 * filesystem access and version-specific config support for zero
 * marginal signal. Two utility-shaped tokens together is both sparse
 * enough to avoid false positives on class names like "site-header
 * active" and common enough to catch any real Tailwind project on the
 * first JSX file we look at.
 */
function hasTailwindSignal(files: readonly ParsedFile[]): boolean {
  for (const f of files) {
    if (f.ast.language !== "tsx" && f.ast.language !== "jsx") continue;
    if (fileHasTailwindClass(f.ast.root as import("../types/ast.ts").TsxModule)) return true;
  }
  return false;
}

function fileHasTailwindClass(root: import("../types/ast.ts").TsxModule): boolean {
  for (const el of walkJsxElements(root)) {
    for (const attr of el.attributes) {
      if (attr.name !== "className" && attr.name !== "class") continue;
      if (attr.value?.kind !== "StringLiteral") continue;
      if (looksLikeTailwindClassString(attr.value.value)) return true;
    }
  }
  return false;
}

/**
 * Two tokens of shape `<letters>-<letters-or-digits>` (e.g. `bg-red-500
 * text-center`, `md:hover:text-white flex`) are a strong Tailwind
 * signal. Variants with `:` (`md:`, `hover:`, `dark:`) count. Arbitrary
 * values in `[...]` also count when attached to a utility prefix.
 */
function looksLikeTailwindClassString(classString: string): boolean {
  const tokens = classString.trim().split(/\s+/);
  let matches = 0;
  for (const token of tokens) {
    if (TAILWIND_TOKEN_RE.test(token)) {
      matches += 1;
      if (matches >= 2) return true;
    }
  }
  return false;
}

const TAILWIND_TOKEN_RE = /^(?:[a-z]+:)*-?[a-z]+(?:-[a-z0-9/.%]+)+(?:\[[^\]]*\])?$/i;

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
    if (!/^[A-Z]/.test(el.tagName)) continue;
    if (wrapperSet.has(el.tagName)) continue;
    const interactive = elementIsInteractive(el);
    const existing = acc.opaqueComponents.get(el.tagName);
    if (existing) {
      existing.callSites += 1;
      if (interactive) existing.interactive = true;
    } else {
      acc.opaqueComponents.set(el.tagName, { callSites: 1, interactive });
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
