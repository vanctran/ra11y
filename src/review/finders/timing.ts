/**
 * Candidate finder: review/timing
 * Criteria: wcag22:2.2.1 (timing adjustable, A)
 *           wcag22:2.2.3 (no timing, AAA)
 *           wcag22:2.2.4 (interruptions, AAA)
 *           wcag22:2.2.5 (re-authenticating, AAA)
 *           wcag22:2.2.6 (timeouts, AAA)
 *
 * Spec:  https://www.w3.org/TR/WCAG22/#timing-adjustable
 *        https://www.w3.org/TR/WCAG22/#no-timing
 *        https://www.w3.org/TR/WCAG22/#interruptions
 *        https://www.w3.org/TR/WCAG22/#re-authenticating
 *        https://www.w3.org/TR/WCAG22/#timeouts
 *
 * Surfaces two concrete signals of time-dependent behavior the reviewer
 * must evaluate: HTML <meta http-equiv="refresh"> and JS calls to
 * setTimeout / setInterval. Per CLAUDE.md §1 we don't try to guess
 * whether the duration is long enough to need a user control, whether
 * the interval is "essential" under the WCAG exception, or whether a
 * setTimeout is a session timeout vs a cosmetic debounce — those are
 * judgments the reviewer makes from the surrounding code. We also
 * don't classify user-facing-ness by filename: `authManager` might
 * house a real session timeout, `useDebouncedCallback` might govern
 * user-perceived responsiveness. Filename regex hints risked confident
 * wrong output the agent couldn't tell to mistrust (CLAUDE.md §1,
 * "don't duplicate capability the agent already has"), so the reason
 * text names the common dismissal categories generically instead.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { findHtmlElementsByTag, findJsxElementsByTag } from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  JsxElement,
  SourcePosition,
  TsxModule,
} from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { RuleContext } from "../../types/rule.ts";

const CRITERION_IDS = [
  "wcag22:2.2.1",
  "wcag21:2.2.1",
  "wcag22:2.2.3",
  "wcag21:2.2.3",
  "wcag22:2.2.4",
  "wcag21:2.2.4",
  "wcag22:2.2.5",
  "wcag21:2.2.5",
  "wcag22:2.2.6",
  "wcag21:2.2.6",
] as const;

/** Source-text patterns for JS timing APIs. */
const SOURCE_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  {
    pattern: /\bsetInterval\s*\(/g,
    label: "setInterval() call",
  },
  {
    pattern: /\bsetTimeout\s*\(/g,
    label: "setTimeout() call",
  },
];

const META_REFRESH_REASON =
  '<meta http-equiv="refresh"> — page auto-refreshes or redirects; verify the user can pause, extend, or disable the refresh per WCAG 2.2.1';

const JS_REASON_PREFIX =
  " — verify the user can pause, extend, or disable any user-facing time limit this governs (not required for session-keepalive / debounce / animation)";

export const finder = defineCandidateFinder({
  id: "review/timing",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      'Finds <meta http-equiv="refresh"> and setTimeout/setInterval calls — signals of time-dependent behavior that require a user control under WCAG 2.2.x.',
    reviewPrompt:
      "For each location, determine what the timer governs. If it imposes a user-facing time limit (session timeout, auto-advancing carousel, form timeout, re-auth), verify the user can turn it off, adjust it, or extend it with 20 s warning. If it is essential (auctions, real-time events) or not user-facing (debounce, polling, animation frame scheduling), no action is needed.",
    references: [
      "https://www.w3.org/TR/WCAG22/#timing-adjustable",
      "https://www.w3.org/TR/WCAG22/#no-timing",
      "https://www.w3.org/TR/WCAG22/#interruptions",
      "https://www.w3.org/TR/WCAG22/#re-authenticating",
      "https://www.w3.org/TR/WCAG22/#timeouts",
    ],
  },
  find(ctx) {
    const out: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      for (const el of findMetaRefreshHtml(ctx.ast as HtmlDocument)) {
        emitAtLocation(el.loc.start, META_REFRESH_REASON, ctx.filePath, out);
      }
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      for (const el of findMetaRefreshJsx(ctx.ast as TsxModule)) {
        emitAtLocation(el.loc.start, META_REFRESH_REASON, ctx.filePath, out);
      }
    }
    findSourceCandidates(ctx, out);
    return out;
  },
});

function findMetaRefreshHtml(doc: HtmlDocument): readonly HtmlElement[] {
  const hits: HtmlElement[] = [];
  for (const el of findHtmlElementsByTag(doc, "meta")) {
    const attr = el.attributes.find((a) => a.name.toLowerCase() === "http-equiv");
    if (!attr || attr.value === null) continue;
    if (attr.value.toLowerCase().trim() === "refresh") hits.push(el);
  }
  return hits;
}

function findMetaRefreshJsx(module: TsxModule): readonly JsxElement[] {
  const hits: JsxElement[] = [];
  for (const el of findJsxElementsByTag(module, "meta")) {
    const attr = el.attributes.find((a) => a.name === "http-equiv" || a.name === "httpEquiv");
    if (!attr) continue;
    if (attr.value?.kind !== "StringLiteral") continue;
    if (attr.value.value.toLowerCase().trim() === "refresh") hits.push(el);
  }
  return hits;
}

function findSourceCandidates(ctx: RuleContext, out: ReviewCandidate[]): void {
  const seen = new Set<number>();
  for (const { pattern, label } of SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      if (seen.has(offset)) continue;
      seen.add(offset);
      const { line, column } = offsetToLineColumn(ctx.source, offset);
      for (const criterionId of CRITERION_IDS) {
        // Confidence "medium": setTimeout/setInterval is concrete
        // evidence of a timer, but the reviewer's question — "does
        // this govern a user-facing time limit?" — depends on what
        // the timer actually does. Session-keepalive vs debounce vs
        // animation are indistinguishable from the call site alone.
        // Per CLAUDE.md §1 we don't gate on duration thresholds; the
        // agent reading the surrounding code is the only correct
        // arbiter, so we surface at medium and let the reason text
        // carry the dismissal vocabulary.
        out.push({
          criterionId,
          location: { filePath: ctx.filePath, line, column },
          reason: `${label}${JS_REASON_PREFIX}`,
          confidence: "medium",
        });
      }
    }
  }
}

function emitAtLocation(
  pos: SourcePosition,
  reason: string,
  filePath: string,
  out: ReviewCandidate[],
): void {
  for (const criterionId of CRITERION_IDS) {
    // Confidence "high": `<meta http-equiv="refresh">` is a
    // deterministic, single-purpose signal — the page IS auto-
    // refreshing. The reviewer just confirms the user control.
    out.push({
      criterionId,
      location: { filePath, line: pos.line, column: pos.column },
      reason,
      confidence: "high",
    });
  }
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  const cap = Math.min(offset, source.length);
  for (let i = 0; i < cap; i++) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}
