/**
 * Candidate finder: review/multiple-ways
 * Criteria: wcag22:2.4.5, wcag21:2.4.5, section508:2.4.5, en301549:9.2.4.5
 * Spec: https://www.w3.org/TR/WCAG22/#multiple-ways
 *
 * Flags likely root-layout files that expose none of four common
 * "multiple ways" signals: a search mechanism, a sitemap link, a
 * navigation landmark with multiple direct links, or a breadcrumb.
 * WCAG 2.4.5 is page-set level, so this finder uses root-layout files
 * as the narrowest static proxy.
 *
 * Review finder - biased toward false positives. Output is a checklist
 * of files to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { FileContext, Language } from "../../types/rule.ts";

const CRITERION_IDS = [
  "wcag22:2.4.5",
  "wcag21:2.4.5",
  "section508:2.4.5",
  "en301549:9.2.4.5",
] as const;

const ROOT_LAYOUT_FILE_RE = /(?:^|[\\/])(?:layout|_app|app|root)\.[jt]sx?$/i;
const SITEMAP_RE = /site-?map/i;
const BREADCRUMB_RE = /breadcrumb/i;
const DIRECT_NAV_LINK_MIN = 3;

export const finder = defineCandidateFinder({
  id: "review/multiple-ways",
  criterionIds: [...CRITERION_IDS],
  scope: "document",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  // 2.4.5 is page-set level. One question for the whole project, not
  // one per root-layout file — multi-root projects (e.g. a Jinja
  // shell serving a React SPA) otherwise get the same prompt three or
  // four times.
  uniquePerCriterion: true,
  docs: {
    description:
      "Finds likely root-layout files that show no search, sitemap, breadcrumb, or multi-link navigation signal, which may mean users only have one way to locate pages.",
    reviewPrompt:
      "Verify the page set offers more than one way to locate pages, such as search, a sitemap, a breadcrumb trail, or a substantial navigation menu. This check uses a root-layout proxy, so if the alternative mechanism is injected elsewhere, confirm it still reaches users consistently.",
    references: [
      "https://www.w3.org/TR/WCAG22/#multiple-ways",
      "https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language === "html") {
      return findHtmlCandidates(ctx, ctx.ast as HtmlDocument);
    }
    if (!isJsLike(ctx.language)) return;
    return findJsxCandidates(ctx, ctx.ast as TsxModule);
  },
});

function findHtmlCandidates(ctx: FileContext, root: HtmlDocument): readonly ReviewCandidate[] {
  if (!looksLikeHtmlRootLayout(root, ctx.filePath)) return [];
  if (hasHtmlMultipleWaysSignal(root)) return [];
  const location = firstHtmlLocation(root);
  return candidatesForAllCriteria(ctx.filePath, location.line, location.column);
}

function findJsxCandidates(ctx: FileContext, root: TsxModule): readonly ReviewCandidate[] {
  if (!looksLikeJsxRootLayout(root, ctx.filePath)) return [];
  if (hasJsxMultipleWaysSignal(root)) return [];
  const location = firstJsxLocation(root);
  return candidatesForAllCriteria(ctx.filePath, location.line, location.column);
}

function isJsLike(language: Language): boolean {
  return language === "tsx" || language === "jsx" || language === "ts" || language === "js";
}

function looksLikeHtmlRootLayout(root: HtmlDocument, filePath: string): boolean {
  if (matchesRootLayoutFile(filePath)) return true;
  const first = firstHtmlElement(root);
  return first?.tagName.toLowerCase() === "html";
}

function looksLikeJsxRootLayout(root: TsxModule, filePath: string): boolean {
  if (matchesRootLayoutFile(filePath)) return true;
  const first = root.jsxElements[0];
  if (!first) return false;
  return first.tagName === "html" || first.tagName === "RootLayout" || first.tagName === "Layout";
}

function matchesRootLayoutFile(filePath: string): boolean {
  return ROOT_LAYOUT_FILE_RE.test(filePath);
}

function hasHtmlMultipleWaysSignal(root: HtmlDocument): boolean {
  return (
    hasHtmlSearchSignal(root) ||
    hasHtmlSitemapSignal(root) ||
    hasHtmlNavigationSignal(root) ||
    hasHtmlBreadcrumbSignal(root)
  );
}

function hasJsxMultipleWaysSignal(root: TsxModule): boolean {
  return (
    hasJsxSearchSignal(root) ||
    hasJsxSitemapSignal(root) ||
    hasJsxNavigationSignal(root) ||
    hasJsxBreadcrumbSignal(root)
  );
}

function hasHtmlSearchSignal(root: HtmlDocument): boolean {
  for (const el of walkHtmlElements(root)) {
    if (isHtmlSearchInput(el) || isHtmlSearchForm(el)) return true;
  }
  return false;
}

function hasJsxSearchSignal(root: TsxModule): boolean {
  for (const el of walkJsxElements(root)) {
    if (isJsxSearchInput(el) || isJsxSearchForm(el)) return true;
  }
  return false;
}

function hasHtmlSitemapSignal(root: HtmlDocument): boolean {
  for (const el of walkHtmlElements(root)) {
    if (hasSitemapTarget(getHtmlAttribute(el, "href"))) return true;
    if (hasSitemapTarget(getHtmlAttribute(el, "to"))) return true;
    if (hasSitemapTarget(getHtmlAttribute(el, "path"))) return true;
  }
  return false;
}

function hasJsxSitemapSignal(root: TsxModule): boolean {
  for (const el of walkJsxElements(root)) {
    if (hasSitemapTarget(getJsxAttributeString(el, "href"))) return true;
    if (hasSitemapTarget(getJsxAttributeString(el, "to"))) return true;
    if (hasSitemapTarget(getJsxAttributeString(el, "path"))) return true;
  }
  return false;
}

function hasHtmlNavigationSignal(root: HtmlDocument): boolean {
  for (const el of walkHtmlElements(root)) {
    if (isHtmlNavigationContainer(el) && countDirectHtmlAnchors(el) >= DIRECT_NAV_LINK_MIN) {
      return true;
    }
  }
  return false;
}

function hasJsxNavigationSignal(root: TsxModule): boolean {
  for (const el of walkJsxElements(root)) {
    if (isJsxNavigationContainer(el) && countDirectJsxAnchors(el) >= DIRECT_NAV_LINK_MIN) {
      return true;
    }
  }
  return false;
}

function hasHtmlBreadcrumbSignal(root: HtmlDocument): boolean {
  for (const el of walkHtmlElements(root)) {
    if (normalizeLower(getHtmlAttribute(el, "aria-label")) === "breadcrumb") return true;
  }
  return false;
}

function hasJsxBreadcrumbSignal(root: TsxModule): boolean {
  for (const el of walkJsxElements(root)) {
    if (BREADCRUMB_RE.test(el.tagName)) return true;
    if (normalizeLower(getJsxAttributeString(el, "aria-label")) === "breadcrumb") return true;
  }
  return false;
}

function isHtmlSearchInput(el: HtmlElement): boolean {
  return (
    el.tagName.toLowerCase() === "input" &&
    normalizeLower(getHtmlAttribute(el, "type")) === "search"
  );
}

function isHtmlSearchForm(el: HtmlElement): boolean {
  return (
    el.tagName.toLowerCase() === "form" && normalizeLower(getHtmlAttribute(el, "role")) === "search"
  );
}

function isJsxSearchInput(el: JsxElement): boolean {
  return el.tagName === "input" && normalizeLower(getJsxAttributeString(el, "type")) === "search";
}

function isJsxSearchForm(el: JsxElement): boolean {
  return el.tagName === "form" && normalizeLower(getJsxAttributeString(el, "role")) === "search";
}

function hasSitemapTarget(value: string | null): boolean {
  return value !== null && SITEMAP_RE.test(value);
}

function isHtmlNavigationContainer(el: HtmlElement): boolean {
  return (
    el.tagName.toLowerCase() === "nav" ||
    normalizeLower(getHtmlAttribute(el, "role")) === "navigation"
  );
}

function isJsxNavigationContainer(el: JsxElement): boolean {
  return el.tagName === "nav" || normalizeLower(getJsxAttributeString(el, "role")) === "navigation";
}

function countDirectHtmlAnchors(el: HtmlElement): number {
  let count = 0;
  for (const child of el.children) {
    if (child.kind !== "HtmlElement") continue;
    if (child.tagName.toLowerCase() === "a") count += 1;
  }
  return count;
}

function countDirectJsxAnchors(el: JsxElement): number {
  let count = 0;
  for (const child of el.children) {
    if (child.kind !== "JsxElement") continue;
    if (child.tagName === "a") count += 1;
  }
  return count;
}

function firstHtmlElement(root: HtmlDocument): HtmlElement | null {
  for (const child of root.children) {
    if (child.kind === "HtmlElement") return child;
  }
  return null;
}

function firstHtmlLocation(root: HtmlDocument): { line: number; column: number } {
  const first = firstHtmlElement(root);
  if (!first) return { line: 1, column: 1 };
  return { line: first.loc.start.line, column: first.loc.start.column };
}

function firstJsxLocation(root: TsxModule): { line: number; column: number } {
  const first = root.jsxElements[0];
  if (!first) return { line: 1, column: 1 };
  return { line: first.loc.start.line, column: first.loc.start.column };
}

function normalizeLower(value: string | null): string | null {
  return value?.trim().toLowerCase() ?? null;
}

function candidatesForAllCriteria(
  filePath: string,
  line: number,
  column: number,
): readonly ReviewCandidate[] {
  const reason =
    "Likely root layout has no search, sitemap, breadcrumb, or 3-link navigation signal; verify users have more than one way to locate pages";
  return CRITERION_IDS.map((criterionId) => ({
    criterionId,
    location: { filePath, line, column },
    reason,
  }));
}
