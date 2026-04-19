/**
 * Candidate finder: review/consistent-identification
 * Criteria: wcag22:3.2.4, wcag21:3.2.4, section508:3.2.4, en301549:9.3.2.4
 * Spec: https://www.w3.org/TR/WCAG22/#consistent-identification
 *
 * WCAG 3.2.4 (AA) says components with the same functionality within a
 * set of pages must be identified consistently. Process-aware from the
 * start: for each declared `processes` entry (ADR 0016), index every
 * `<button>` / `<a>` / `<input type="submit|button">` across the
 * process's pages by a semantic key — `aria-label` → `data-testid` →
 * visible text — and flag keys whose visible labels disagree across
 * ≥2 pages. Components with none of the three ("pure positional") are
 * skipped; there is no key to match across pages.
 *
 * Without a declared `processes` config, the finder emits zero
 * candidates — honest "needs config" per ADR 0016 and the AI-first
 * doctrine on heuristic suppression (no file-path-pattern fallback:
 * the scanner cannot tell whether two routes participate in the same
 * user journey, and guessing produces confident wrong answers).
 *
 * Review finder — biased toward false positives (two buttons sharing
 * an identifier may represent genuinely different actions). The output
 * is a checklist of places to verify, not a list of failures.
 */

import { isAbsolute, resolve } from "node:path";
import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  JsxElement,
  SourcePosition,
  TsxModule,
} from "../../types/ast.ts";
import type { Process } from "../../types/config.ts";
import type { ProjectFile, ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:3.2.4",
  "wcag21:3.2.4",
  "section508:3.2.4",
  "en301549:9.3.2.4",
] as const;

/** One identifiable component observed in one page of one process. */
interface ComponentInstance {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  /** Stable cross-page identifier — `aria-label` | `data-testid` | visible text. */
  readonly key: string;
  /** Which signal produced `key`, for reason-text clarity. */
  readonly keySource: "aria-label" | "data-testid" | "text";
  /** Visible label (or accessible-name fallback) — what this finder compares. */
  readonly label: string;
  /** Selector shape for reason text — `<button>`, `<a>`, `<input type="submit">`. */
  readonly selector: string;
}

export const finder = defineCandidateFinder({
  id: "review/consistent-identification",
  criterionIds: [...CRITERION_IDS],
  scope: "document",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      "Compares button, link, and submit-input labels across the ordered pages of each declared `processes` entry and flags components whose identifier (aria-label or data-testid) appears on multiple pages with differing visible labels, which may fail WCAG 3.2.4 Consistent Identification.",
    reviewPrompt:
      "Verify that components with the same functionality carry the same identifying label on every page of the process. The candidate's reason names each divergent label and the page it appeared on so you can compare the occurrences directly. If the components represent different actions that happen to share an identifier, either the identifier is wrong or the labels need disambiguating prefixes.",
    references: [
      "https://www.w3.org/TR/WCAG22/#consistent-identification",
      "https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html",
    ],
  },
  afterProject(ctx) {
    const processes = ctx.processes;
    // Honest "needs config" — no `processes`, no cross-page evidence, no candidates.
    if (processes === undefined || processes.length === 0) return [];
    const fileByAbsPath = indexFilesByAbsPath(ctx.files);
    const out: ReviewCandidate[] = [];
    for (const process of processes) collectProcessCandidates(process, fileByAbsPath, out);
    return out;
  },
});

/**
 * Indexes parsed files by both their absolute path and the raw path
 * from `ProjectFile.filePath`. Scan orchestration pre-resolves process
 * pages to absolute paths, but fixtures / integration tests often pass
 * unresolved paths — indexing both forms keeps the finder callable
 * from either site.
 */
function indexFilesByAbsPath(files: readonly ProjectFile[]): ReadonlyMap<string, ProjectFile> {
  const out = new Map<string, ProjectFile>();
  for (const f of files) {
    out.set(f.filePath, f);
    if (!isAbsolute(f.filePath)) {
      out.set(resolve(f.filePath), f);
    }
  }
  return out;
}

/** For one process: index keyed components across pages, emit one candidate per divergent key-group. */
function collectProcessCandidates(
  process: Process,
  fileByAbsPath: ReadonlyMap<string, ProjectFile>,
  out: ReviewCandidate[],
): void {
  const groups = new Map<string, ComponentInstance[]>();
  for (const pagePath of process.pages) {
    const file = resolveProcessPage(pagePath, fileByAbsPath);
    if (file === undefined) continue;
    const instances: ComponentInstance[] = [];
    collectInstancesFromFile(file, instances);
    for (const inst of instances) {
      const bucket = groups.get(inst.key);
      if (bucket) bucket.push(inst);
      else groups.set(inst.key, [inst]);
    }
  }
  for (const members of groups.values()) {
    emitIfDivergent(process, members, out);
  }
}

function resolveProcessPage(
  pagePath: string,
  fileByAbsPath: ReadonlyMap<string, ProjectFile>,
): ProjectFile | undefined {
  const direct = fileByAbsPath.get(pagePath);
  if (direct) return direct;
  if (!isAbsolute(pagePath)) return fileByAbsPath.get(resolve(pagePath));
  return undefined;
}

function collectInstancesFromFile(file: ProjectFile, out: ComponentInstance[]): void {
  const ast = file.ast;
  if (ast.language === "html") {
    collectHtmlInstances(file.filePath, ast.root as HtmlDocument, out);
    return;
  }
  if (ast.language === "tsx" || ast.language === "jsx") {
    collectJsxInstances(file.filePath, ast.root as TsxModule, out);
  }
}

function collectHtmlInstances(
  filePath: string,
  root: HtmlDocument,
  out: ComponentInstance[],
): void {
  for (const el of walkHtmlElements(root)) {
    const inst = htmlInstanceFor(filePath, el);
    if (inst !== null) out.push(inst);
  }
}

function collectJsxInstances(filePath: string, root: TsxModule, out: ComponentInstance[]): void {
  for (const el of walkJsxElements(root)) {
    const inst = jsxInstanceFor(filePath, el);
    if (inst !== null) out.push(inst);
  }
}

function htmlInstanceFor(filePath: string, el: HtmlElement): ComponentInstance | null {
  const selector = htmlSelectorFor(el);
  if (selector === null) return null;
  const ariaLabel = normalizeLabel(getHtmlAttribute(el, "aria-label"));
  const dataTestId = normalizeLabel(getHtmlAttribute(el, "data-testid"));
  const visible = htmlVisibleLabel(el);
  return buildInstance(filePath, el.loc.start, selector, ariaLabel, dataTestId, visible);
}

function jsxInstanceFor(filePath: string, el: JsxElement): ComponentInstance | null {
  const selector = jsxSelectorFor(el);
  if (selector === null) return null;
  const ariaLabel = normalizeLabel(getJsxAttributeString(el, "aria-label"));
  const dataTestId = normalizeLabel(getJsxAttributeString(el, "data-testid"));
  const visible = jsxVisibleLabel(el);
  return buildInstance(filePath, el.loc.start, selector, ariaLabel, dataTestId, visible);
}

/**
 * Assembles the `{ key, keySource, label }` triple. Identifier
 * precedence: aria-label → data-testid → visible text. Pure-positional
 * components (none of the three) return `null`.
 */
function buildInstance(
  filePath: string,
  start: SourcePosition,
  selector: string,
  ariaLabel: string,
  dataTestId: string,
  visible: string,
): ComponentInstance | null {
  const label = visible === "" ? ariaLabel : visible;
  if (ariaLabel !== "") {
    return makeInstance(filePath, start, selector, ariaLabel, "aria-label", label);
  }
  if (dataTestId !== "") {
    return makeInstance(filePath, start, selector, dataTestId, "data-testid", label);
  }
  if (visible !== "") {
    return makeInstance(filePath, start, selector, visible, "text", visible);
  }
  return null;
}

function makeInstance(
  filePath: string,
  start: SourcePosition,
  selector: string,
  key: string,
  keySource: ComponentInstance["keySource"],
  label: string,
): ComponentInstance {
  return {
    filePath,
    line: start.line,
    column: start.column,
    key,
    keySource,
    label,
    selector,
  };
}

function htmlSelectorFor(el: HtmlElement): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "<button>";
  if (tag === "a") return "<a>";
  if (tag === "input") {
    const type = normalizeLabel(getHtmlAttribute(el, "type"));
    if (type === "submit" || type === "button") return `<input type="${type}">`;
  }
  return null;
}

function jsxSelectorFor(el: JsxElement): string | null {
  if (el.tagName === "button") return "<button>";
  if (el.tagName === "a") return "<a>";
  if (el.tagName === "input") {
    const type = normalizeLabel(getJsxAttributeString(el, "type"));
    if (type === "submit" || type === "button") return `<input type="${type}">`;
  }
  return null;
}

/** Trimmed text content for `<button>` / `<a>`; `value` for submit/button inputs. */
function htmlVisibleLabel(el: HtmlElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "input") return normalizeLabel(getHtmlAttribute(el, "value"));
  return normalizeLabel(htmlTextContent(el));
}

function jsxVisibleLabel(el: JsxElement): string {
  if (el.tagName === "input") return normalizeLabel(getJsxAttributeString(el, "value"));
  return normalizeLabel(jsxTextContent(el));
}

function normalizeLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Emits one candidate per semantic-key group whose visible labels
 * disagree across ≥2 pages. Location is the group's first-occurring
 * instance; reason enumerates every `label` → `page` pair so the
 * agent sees the full evidence without hunting. Confidence "medium":
 * identifier match is concrete static evidence, but whether the
 * instances represent the *same semantic action* is a judgment the
 * scanner cannot make from source alone.
 */
function emitIfDivergent(
  process: Process,
  members: readonly ComponentInstance[],
  out: ReviewCandidate[],
): void {
  if (members.length < 2) return;
  const byPage = groupByPage(members);
  if (byPage.size < 2) return;
  const labelsByPage = pickOneLabelPerPage(byPage);
  const distinctLabels = new Set(labelsByPage.map(([_path, label]) => label));
  if (distinctLabels.size < 2) return;
  const head = members[0];
  if (head === undefined) return;
  const reason = buildReason(process, head, labelsByPage);
  for (const criterionId of CRITERION_IDS) {
    out.push({
      criterionId,
      location: { filePath: head.filePath, line: head.line, column: head.column },
      reason,
      confidence: "medium",
    });
  }
}

/** Groups a semantic-key bucket by page file path, preserving first-seen order. */
function groupByPage(members: readonly ComponentInstance[]): Map<string, ComponentInstance[]> {
  const out = new Map<string, ComponentInstance[]>();
  for (const inst of members) {
    const bucket = out.get(inst.filePath);
    if (bucket) bucket.push(inst);
    else out.set(inst.filePath, [inst]);
  }
  return out;
}

/** First instance per page — one label per page in the reason text, order follows declared page order. */
function pickOneLabelPerPage(
  byPage: ReadonlyMap<string, readonly ComponentInstance[]>,
): readonly [string, string][] {
  const out: [string, string][] = [];
  for (const [path, instances] of byPage) {
    const first = instances[0];
    if (first !== undefined) out.push([path, first.label]);
  }
  return out;
}

function buildReason(
  process: Process,
  head: ComponentInstance,
  labelsByPage: readonly [string, string][],
): string {
  const pairs = labelsByPage.map(([path, label]) => `\`${label}\` on ${path}`).join(", ");
  const keyDescriptor = describeKey(head);
  return (
    `Component ${head.selector} shares ${keyDescriptor} across pages in process \`${process.name}\` ` +
    `but shows different labels: ${pairs}. ` +
    `Verify these instances represent the same action and, if so, reconcile the labels.`
  );
}

function describeKey(inst: ComponentInstance): string {
  if (inst.keySource === "aria-label") return `aria-label="${inst.key}"`;
  if (inst.keySource === "data-testid") return `data-testid="${inst.key}"`;
  return `the label "${inst.key}"`;
}
