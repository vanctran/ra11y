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
 * Strategy: collect every `<nav>` (or `role="navigation"`) across the
 * scanned files, fingerprint each by the *set* of anchor labels, and
 * flag groups where two instances share the set but differ in order.
 * The divergence is the evidence — we don't threshold on how many
 * files participate or how many links match; any provable reorder of
 * the same link set is the surface the agent wants to see. The reason
 * names the counterpart file:line so one read resolves the question.
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
    if (!isHtmlNavContainer(el)) continue;
    const order = collectHtmlNavLabels(el);
    if (order.length === 0) continue;
    out.push(instanceFromLoc(filePath, el.loc.start, order));
  }
}

function collectJsxNavs(filePath: string, root: TsxModule, out: NavInstance[]): void {
  for (const el of walkJsxElements(root)) {
    if (!isJsxNavContainer(el)) continue;
    const order = collectJsxNavLabels(el);
    if (order.length === 0) continue;
    out.push(instanceFromLoc(filePath, el.loc.start, order));
  }
}

function instanceFromLoc(
  filePath: string,
  start: SourcePosition,
  order: readonly string[],
): NavInstance {
  return { filePath, line: start.line, column: start.column, order };
}

function isHtmlNavContainer(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() === "nav") return true;
  return normalizeLower(getHtmlAttribute(el, "role")) === "navigation";
}

function isJsxNavContainer(el: JsxElement): boolean {
  if (el.tagName === "nav") return true;
  return normalizeLower(getJsxAttributeString(el, "role")) === "navigation";
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

function normalizeLabel(value: string): string {
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
    const reason = `${reasonCore} — verify the repeated navigational mechanism appears in the same relative order on both pages`;
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
