/**
 * Candidate finder: review/consistent-navigation
 * Criteria: wcag22:3.2.3, wcag21:3.2.3, section508:3.2.3, en301549:9.3.2.3
 * Spec: https://www.w3.org/TR/WCAG22/#consistent-navigation
 *
 * WCAG 3.2.3 (AA) says navigational mechanisms repeated on multiple
 * pages within a set occur in the same relative order each time,
 * unless the user initiated the change. A page-set-level check —
 * static analysis can see the `<nav>` markup across route files and
 * spot divergent orderings without a live site.
 *
 * Two evaluation paths, chosen per invocation:
 *
 *   1. Process-aware (preferred). When `ctx.processes` is declared
 *      (see ADR 0016), each named process is the unit of comparison.
 *      Navigation landmarks on the process's pages are collapsed to a
 *      signature `{ role, accessibleName, linkCount, linkLabels }` and
 *      compared against the process's *modal* signature; any page
 *      whose landmark diverges emits a candidate scoped to that page.
 *      Deterministic evidence — the caller has told us which pages
 *      participate in the user journey.
 *
 *   2. Heuristic fallback. When `ctx.processes` is absent or empty,
 *      the finder falls back to whole-project comparison: collect
 *      every `<nav>` across every scanned file, group by the *set* of
 *      link labels, and flag groups that share the set but disagree
 *      on order. The reason text on each candidate notes the
 *      config-primitive upgrade path so an agent reading the finding
 *      can nudge the caller toward declarative evidence.
 *
 * AI-first notes (CLAUDE.md §1):
 * - Surface, don't suppress. No filename / identifier filter on navs.
 * - No numeric-threshold gate ("at least N shared links"): the spec
 *   bar is "the same navigational mechanism in a different order,"
 *   not "a large navigational mechanism." Two-link navs count.
 * - Reason text carries the counterpart location so the agent can
 *   compare in one Read call rather than hunting for the other nav.
 * - The finder is cross-file; relies on `afterProject` to avoid
 *   per-file state and to respect the parsed-AST-only rule (no
 *   re-parsing).
 *
 * Review finder — biased toward false positives (site-authored
 * reorders are sometimes intentional / user-initiated). The output
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
  "wcag22:3.2.3",
  "wcag21:3.2.3",
  "section508:3.2.3",
  "en301549:9.3.2.3",
] as const;

/** A single `<nav>` (or role=navigation) observed in one scanned file. */
interface NavInstance {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  /** Ordered, normalized link labels — the thing 3.2.3 cares about. */
  readonly order: readonly string[];
  /**
   * Role carried by the landmark — `"nav"` for a literal `<nav>` tag,
   * `"navigation"` for `role="navigation"` on any other element.
   * Participates in the signature so two landmarks with different
   * roles don't silently merge when the process-aware path picks a
   * modal signature.
   */
  readonly role: "nav" | "navigation";
  /**
   * Accessible name declared on the landmark — the trimmed `aria-label`
   * value when present, otherwise `""`. Used by the process-aware path
   * to distinguish e.g. a "primary" nav from a "footer" nav when the
   * same process page carries both.
   */
  readonly accessibleName: string;
}

export const finder = defineCandidateFinder({
  id: "review/consistent-navigation",
  criterionIds: [...CRITERION_IDS],
  scope: "document",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      "Compares `<nav>` structures across scanned files and flags navs that share the same set of links but emit them in a different relative order, which may fail WCAG 3.2.3 Consistent Navigation.",
    reviewPrompt:
      "Verify the navigational mechanism appears in the same relative order on every page that uses it, unless the user initiated the change. The candidate's reason names the counterpart nav so you can compare both files directly.",
    references: [
      "https://www.w3.org/TR/WCAG22/#consistent-navigation",
      "https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html",
    ],
  },
  afterProject(ctx) {
    const processes = ctx.processes;
    if (processes !== undefined && processes.length > 0) {
      return flagViaProcesses(processes, ctx.files);
    }
    const instances: NavInstance[] = [];
    for (const file of ctx.files) {
      collectNavs(file, instances);
    }
    return flagDivergentGroups(instances);
  },
});

function collectNavs(file: ProjectFile, out: NavInstance[]): void {
  const ast = file.ast;
  if (ast.language === "html") {
    collectHtmlNavs(file.filePath, ast.root as HtmlDocument, out);
    return;
  }
  if (ast.language === "tsx" || ast.language === "jsx") {
    collectJsxNavs(file.filePath, ast.root as TsxModule, out);
  }
}

function collectHtmlNavs(filePath: string, root: HtmlDocument, out: NavInstance[]): void {
  for (const el of walkHtmlElements(root)) {
    const role = htmlNavRole(el);
    if (role === null) continue;
    const order = collectHtmlNavLabels(el);
    if (order.length === 0) continue;
    const accessibleName = normalizeLabel(getHtmlAttribute(el, "aria-label"));
    out.push(instanceFromLoc(filePath, el.loc.start, order, role, accessibleName));
  }
}

function collectJsxNavs(filePath: string, root: TsxModule, out: NavInstance[]): void {
  for (const el of walkJsxElements(root)) {
    const role = jsxNavRole(el);
    if (role === null) continue;
    const order = collectJsxNavLabels(el);
    if (order.length === 0) continue;
    const accessibleName = normalizeLabel(getJsxAttributeString(el, "aria-label"));
    out.push(instanceFromLoc(filePath, el.loc.start, order, role, accessibleName));
  }
}

function instanceFromLoc(
  filePath: string,
  start: SourcePosition,
  order: readonly string[],
  role: "nav" | "navigation",
  accessibleName: string,
): NavInstance {
  return {
    filePath,
    line: start.line,
    column: start.column,
    order,
    role,
    accessibleName,
  };
}

function htmlNavRole(el: HtmlElement): "nav" | "navigation" | null {
  if (el.tagName.toLowerCase() === "nav") return "nav";
  if (normalizeLower(getHtmlAttribute(el, "role")) === "navigation") return "navigation";
  return null;
}

function jsxNavRole(el: JsxElement): "nav" | "navigation" | null {
  if (el.tagName === "nav") return "nav";
  if (normalizeLower(getJsxAttributeString(el, "role")) === "navigation") return "navigation";
  return null;
}

/**
 * Collects the ordered list of anchor labels inside an HTML nav.
 * Treats any descendant element with an `href` attribute as an
 * anchor (so `<a>`, `<Link>`-style custom elements that compile down
 * to `<a>`, and rewritten routed links all participate). Labels are
 * the element's trimmed text content, falling back to the href target
 * when the anchor has no visible text (icon-only links).
 */
function collectHtmlNavLabels(nav: HtmlElement): readonly string[] {
  const labels: string[] = [];
  for (const el of walkHtmlElements(nav)) {
    const href = getHtmlAttribute(el, "href");
    if (href === null) continue;
    const text = htmlTextContent(el);
    const label = normalizeLabel(text === "" ? href : text);
    if (label !== "") labels.push(label);
  }
  return labels;
}

/**
 * JSX equivalent — any JSX element with an `href` or `to` prop counts
 * as a navigation anchor (covers `<a href>`, `<Link to>`, `<NavLink to>`,
 * and custom `<RouterLink>` components without hardcoding names).
 */
function collectJsxNavLabels(nav: JsxElement): readonly string[] {
  const labels: string[] = [];
  for (const el of walkJsxDescendants(nav)) {
    const href = getJsxAttributeString(el, "href") ?? getJsxAttributeString(el, "to");
    if (href === null) continue;
    const text = jsxTextContent(el);
    const label = normalizeLabel(text === "" ? href : text);
    if (label !== "") labels.push(label);
  }
  return labels;
}

function* walkJsxDescendants(root: JsxElement): Iterable<JsxElement> {
  for (const child of root.children) {
    if (child.kind !== "JsxElement") continue;
    yield child;
    yield* walkJsxDescendants(child);
  }
}

function normalizeLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLower(value: string | null): string | null {
  return value?.trim().toLowerCase() ?? null;
}

/**
 * Groups instances by "set of link labels" and flags any group whose
 * members disagree on order. The set signature is the sorted unique
 * labels — two navs with the same labels but a different ordering
 * share a signature and fall into the same group. No membership
 * threshold: a two-link nav reordered across two files is still
 * evidence of a 3.2.3 question the agent should verify.
 */
function flagDivergentGroups(instances: readonly NavInstance[]): readonly ReviewCandidate[] {
  const groups = new Map<string, NavInstance[]>();
  for (const inst of instances) {
    const sig = setSignature(inst.order);
    if (sig === "") continue;
    const bucket = groups.get(sig);
    if (bucket) bucket.push(inst);
    else groups.set(sig, [inst]);
  }
  const out: ReviewCandidate[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const distinctOrderings = new Set(members.map((m) => m.order.join("\u0001")));
    if (distinctOrderings.size < 2) continue;
    emitGroupCandidates(members, out);
  }
  return out;
}

function setSignature(order: readonly string[]): string {
  const uniq = [...new Set(order)].sort();
  return uniq.join("\u0001");
}

function emitGroupCandidates(members: readonly NavInstance[], out: ReviewCandidate[]): void {
  for (const inst of members) {
    const counterpart = pickCounterpart(members, inst);
    if (counterpart === null) continue;
    const reasonCore =
      `<nav> link order diverges from ${counterpart.filePath}:${counterpart.line} ` +
      `— this file: [${inst.order.join(", ")}]; counterpart: [${counterpart.order.join(", ")}]`;
    const reason =
      `${reasonCore} — verify the repeated navigational mechanism appears in the same relative order on both pages. ` +
      `Heuristic match across the whole scanned tree; declare \`processes: [...]\` in ra11y.config.ts to anchor this check deterministically to declared user journeys.`;
    for (const criterionId of CRITERION_IDS) {
      // Confidence "high": the divergent-ordering evidence is concrete
      // — two real navs in the scanned files share a link set and
      // emit them in a different order. The reviewer's question is
      // only whether the divergence is user-initiated.
      out.push({
        criterionId,
        location: { filePath: inst.filePath, line: inst.line, column: inst.column },
        reason,
        confidence: "high",
      });
    }
  }
}

/**
 * Returns a member whose ordering differs from `self`, preferring the
 * deterministically-first such member (by file path, then line). A
 * divergent counterpart always exists when this is called because the
 * caller only reaches this path for groups with ≥2 distinct orderings.
 */
function pickCounterpart(members: readonly NavInstance[], self: NavInstance): NavInstance | null {
  const sorted = [...members].sort(compareInstances);
  for (const m of sorted) {
    if (m === self) continue;
    if (m.filePath === self.filePath && m.line === self.line && m.column === self.column) continue;
    if (sameOrder(m.order, self.order)) continue;
    return m;
  }
  return null;
}

function compareInstances(a: NavInstance, b: NavInstance): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Process-aware path
//
// When `ctx.processes` is declared, each named process is the unit of
// comparison. Per process:
//   1. Collect every nav landmark across the process's declared pages.
//   2. Key each landmark by `{ role, accessibleName }` — a "primary"
//      navigation and a "footer" navigation on the same page are
//      compared only against their own kind across the process.
//   3. For each key-group that spans ≥2 pages, compute the modal
//      signature (most common `{ linkCount, linkLabels }`).
//   4. Any landmark in the group whose signature diverges from the
//      modal one emits a candidate.
//
// Comparison heuristic per the spec of this task: divergence is
// declared when a landmark's link count differs from the modal count
// OR when its ordered link labels differ (Hamming distance > 0 on
// same-length label lists). `<nav>` with no links is skipped — nothing
// to compare.
// ---------------------------------------------------------------------------

function flagViaProcesses(
  processes: readonly Process[],
  files: readonly ProjectFile[],
): readonly ReviewCandidate[] {
  const fileByAbsPath = indexFilesByAbsPath(files);
  const out: ReviewCandidate[] = [];
  for (const process of processes) {
    collectProcessCandidates(process, fileByAbsPath, out);
  }
  return out;
}

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

function resolveProcessPage(
  pagePath: string,
  fileByAbsPath: ReadonlyMap<string, ProjectFile>,
): ProjectFile | undefined {
  const direct = fileByAbsPath.get(pagePath);
  if (direct) return direct;
  if (!isAbsolute(pagePath)) return fileByAbsPath.get(resolve(pagePath));
  return undefined;
}

function collectProcessCandidates(
  process: Process,
  fileByAbsPath: ReadonlyMap<string, ProjectFile>,
  out: ReviewCandidate[],
): void {
  const groupsByKey = new Map<string, NavInstance[]>();
  const pagesSeenByKey = new Map<string, Set<string>>();
  for (const pagePath of process.pages) {
    const file = resolveProcessPage(pagePath, fileByAbsPath);
    if (file === undefined) continue;
    indexPageLandmarks(file, groupsByKey, pagesSeenByKey);
  }
  for (const [key, members] of groupsByKey) {
    const pageCount = pagesSeenByKey.get(key)?.size ?? 0;
    if (pageCount < 2) continue;
    emitProcessDivergences(process, members, out);
  }
}

/**
 * Walks one page's nav landmarks into the cross-page indexes. Split
 * from `collectProcessCandidates` so the outer function stays under
 * the cognitive-complexity budget — each index update is independently
 * simple, the composition is what accumulates complexity.
 */
function indexPageLandmarks(
  file: ProjectFile,
  groupsByKey: Map<string, NavInstance[]>,
  pagesSeenByKey: Map<string, Set<string>>,
): void {
  const instances: NavInstance[] = [];
  collectNavs(file, instances);
  for (const inst of instances) {
    const key = landmarkKey(inst);
    const bucket = groupsByKey.get(key);
    if (bucket) bucket.push(inst);
    else groupsByKey.set(key, [inst]);
    const pages = pagesSeenByKey.get(key);
    if (pages) pages.add(inst.filePath);
    else pagesSeenByKey.set(key, new Set([inst.filePath]));
  }
}

/** Group-key on (role, accessibleName) — separates primary vs footer vs aside navs. */
function landmarkKey(inst: NavInstance): string {
  return `${inst.role}\u0001${inst.accessibleName}`;
}

/**
 * Signature the modal-match compares against — `count:labels`. Two
 * landmarks in the same `{ role, accessibleName }` group are equal
 * when they share this signature. Divergence = count mismatch OR
 * ordered-label mismatch (Hamming > 0 for same-length lists is
 * captured by the label-join differing).
 */
function signatureOf(inst: NavInstance): string {
  return `${inst.order.length}\u0001${inst.order.join("\u0001")}`;
}

/**
 * For one `{ role, accessibleName }` group inside one process: find
 * the modal signature, then emit one candidate per member that
 * diverges from it. Ties broken by first-occurrence order — the
 * authoritative shape of the nav is whichever signature appeared
 * earliest across the declared page sequence.
 */
function emitProcessDivergences(
  process: Process,
  members: readonly NavInstance[],
  out: ReviewCandidate[],
): void {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  members.forEach((m, idx) => {
    const sig = signatureOf(m);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
    if (!firstSeen.has(sig)) firstSeen.set(sig, idx);
  });
  const modal = pickModalSignature(counts, firstSeen);
  if (modal === null) return;
  const modalExample = members.find((m) => signatureOf(m) === modal);
  if (modalExample === undefined) return;
  for (const inst of members) {
    if (signatureOf(inst) === modal) continue;
    const reason = buildProcessReason(process, inst, modalExample);
    for (const criterionId of CRITERION_IDS) {
      // Confidence "high": the deterministic process config tells us
      // exactly which pages participate; the landmark-signature
      // divergence is concrete cross-page evidence. The reviewer's
      // question is only whether the divergence is user-initiated.
      out.push({
        criterionId,
        location: { filePath: inst.filePath, line: inst.line, column: inst.column },
        reason,
        confidence: "high",
      });
    }
  }
}

function pickModalSignature(
  counts: ReadonlyMap<string, number>,
  firstSeen: ReadonlyMap<string, number>,
): string | null {
  let bestSig: string | null = null;
  let bestCount = 0;
  let bestFirstSeen = Number.POSITIVE_INFINITY;
  for (const [sig, count] of counts) {
    const seenAt = firstSeen.get(sig) ?? Number.POSITIVE_INFINITY;
    if (count > bestCount || (count === bestCount && seenAt < bestFirstSeen)) {
      bestSig = sig;
      bestCount = count;
      bestFirstSeen = seenAt;
    }
  }
  return bestSig;
}

function buildProcessReason(
  process: Process,
  inst: NavInstance,
  modalExample: NavInstance,
): string {
  const landmarkDescriptor =
    inst.accessibleName === ""
      ? `<${inst.role === "nav" ? "nav" : `* role="navigation"`}>`
      : `<${inst.role === "nav" ? "nav" : `* role="navigation"`} aria-label="${inst.accessibleName}">`;
  const countPhrase =
    inst.order.length === modalExample.order.length
      ? `link order [${inst.order.join(", ")}] differs from the process-modal order [${modalExample.order.join(", ")}]`
      : `link count ${inst.order.length} differs from the process-modal count ${modalExample.order.length}`;
  return (
    `Navigation landmark ${landmarkDescriptor} on page \`${inst.filePath}\` diverges from the modal navigation in process \`${process.name}\`: ` +
    `${countPhrase} (established on \`${modalExample.filePath}\`:${modalExample.line}). ` +
    `Verify the repeated navigational mechanism appears in the same relative order on every page of the process, unless the user initiated the change.`
  );
}
