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
 * judgments the reviewer makes from the surrounding code.
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

/**
 * Filename/path fragments that strongly suggest a setTimeout/setInterval
 * is NOT a user-facing timer and thus NOT in scope for WCAG 2.2.x. We
 * don't suppress the candidate (the agent still sees it, matching the
 * AI-first consumer rule in CLAUDE.md §1) but we attach a one-phrase
 * hint so the agent can dismiss in a single pass without reading the
 * file. Each entry maps a substring match to the common-case role.
 */
const FILENAME_ROLE_HINTS: readonly { readonly match: RegExp; readonly role: string }[] = [
  { match: /debounce/i, role: "debounce/throttle utility" },
  { match: /throttle/i, role: "debounce/throttle utility" },
  { match: /telemetry|analytics|metrics/i, role: "telemetry/batch-flush" },
  { match: /auth(?:Manager|-manager|Context)?/i, role: "auth/token refresh" },
  { match: /refresh(?:Token|-token)/i, role: "token refresh" },
  { match: /retry|backoff/i, role: "retry/backoff scheduling" },
  { match: /poll|polling/i, role: "background polling" },
  { match: /keepalive|keep-alive|heartbeat/i, role: "connection keepalive" },
  { match: /transport|websocket|socket\b/i, role: "network transport" },
  { match: /queue|buffer|flush/i, role: "batch flush" },
  { match: /worker\b/i, role: "worker scheduling" },
  { match: /animation|raf\b|tween/i, role: "animation frame scheduling" },
  { match: /indexedDb|idb\b|storage/i, role: "storage transaction" },
  { match: /sentry|datadog|newrelic/i, role: "observability client" },
];

function fileRoleHint(filePath: string): string | null {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const basename = filePath.slice(lastSlash + 1);
  for (const { match, role } of FILENAME_ROLE_HINTS) {
    if (match.test(basename)) return role;
  }
  return null;
}

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
  const roleHint = fileRoleHint(ctx.filePath);
  const hintSuffix =
    roleHint === null ? "" : ` (file looks like a ${roleHint} — likely not user-facing)`;
  const seen = new Set<number>();
  for (const { pattern, label } of SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      if (seen.has(offset)) continue;
      seen.add(offset);
      const { line, column } = offsetToLineColumn(ctx.source, offset);
      for (const criterionId of CRITERION_IDS) {
        out.push({
          criterionId,
          location: { filePath: ctx.filePath, line, column },
          reason: `${label}${hintSuffix}${JS_REASON_PREFIX}`,
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
    out.push({
      criterionId,
      location: { filePath, line: pos.line, column: pos.column },
      reason,
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
