/**
 * Candidate finder: review/captcha
 * Criteria: wcag22:3.3.8, wcag22:3.3.9
 *
 * Section 508 and EN 301 549 reference WCAG 2.1 and 2.0; neither
 * standard has an equivalent to SC 3.3.8/3.3.9 today. Cross-standard
 * coverage will extend automatically when the relevant standards add it.
 * Spec: https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum
 *       https://www.w3.org/TR/WCAG22/#accessible-authentication-enhanced
 *
 * Surfaces locations that load or render a CAPTCHA. SC 3.3.8 forbids
 * cognitive function tests in authentication steps unless an alternative
 * is provided or the test is object recognition or personal content.
 * CAPTCHAs based on text transcription, puzzle solving, or image
 * identification of arbitrary objects fail the minimum bar unless a
 * non-cognitive alternative (hardware token, WebAuthn, email magic link)
 * is also offered. A static scan cannot verify the alternative exists —
 * only a human reviewer can.
 *
 * Signal is tight: CAPTCHA component imports and CAPTCHA vendor
 * hostnames have no other purpose in web code. Near-zero false-positive
 * rate.
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { getHtmlAttribute, walkHtmlElements } from "../../engine/ast-helpers.ts";
import type { HtmlDocument } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { RuleContext } from "../../types/rule.ts";

const CRITERION_IDS = ["wcag22:3.3.8", "wcag22:3.3.9"] as const;

/**
 * Known CAPTCHA package names. Matches ES import/require/from-string
 * occurrences. If new popular CAPTCHA libraries appear, extend here.
 * Order doesn't matter; each is matched as a distinct literal.
 */
const CAPTCHA_PACKAGES: readonly string[] = [
  "react-google-recaptcha",
  "react-google-recaptcha-v3",
  "@hcaptcha/react-hcaptcha",
  "react-hcaptcha",
  "@marsidev/react-turnstile",
  "react-turnstile",
  "vue-recaptcha",
  "vue-hcaptcha",
  "ng-recaptcha",
  "react-simple-captcha",
  "svelte-turnstile",
] as const;

/**
 * Known CAPTCHA vendor hostnames. Matched in `<script src>` and in any
 * raw source URL string. All three major vendors serve widgets from
 * dedicated subdomains used for nothing else.
 */
const CAPTCHA_HOSTS: readonly string[] = [
  "www.google.com/recaptcha",
  "www.recaptcha.net",
  "recaptcha.net",
  "js.hcaptcha.com",
  "hcaptcha.com/1/api.js",
  "challenges.cloudflare.com/turnstile",
  "www.arkoselabs.com",
  "client-api.arkoselabs.com",
] as const;

/**
 * JSX component tag names commonly used for CAPTCHA widgets. These
 * appear alongside imports but also as bare component usage when the
 * import uses a star or alias. Exact case-sensitive match — each is a
 * well-known widget component, not a generic word.
 */
const CAPTCHA_COMPONENT_TAGS: ReadonlySet<string> = new Set([
  "ReCAPTCHA",
  "Recaptcha",
  "GoogleReCaptcha",
  "GoogleReCaptchaProvider",
  "HCaptcha",
  "Hcaptcha",
  "Turnstile",
  "CloudflareTurnstile",
]);

export const finder = defineCandidateFinder({
  id: "review/captcha",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      "Finds CAPTCHA widget imports, script tags, and component usages. Authentication flows using a CAPTCHA must also offer a non-cognitive alternative (hardware token, passkey, email magic link).",
    reviewPrompt:
      'Verify that every authentication path carrying this CAPTCHA also offers a non-cognitive alternative. Object-recognition CAPTCHAs ("select all squares with bicycles") and personal-content challenges are allowed; text transcription and puzzle solving are not, unless an alternative is provided. AAA (3.3.9) forbids even object recognition without an alternative.',
    references: [
      "https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum",
      "https://www.w3.org/TR/WCAG22/#accessible-authentication-enhanced",
      "https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    const seen = new Set<string>();
    findImportCandidates(ctx, seen, candidates);
    findComponentCandidates(ctx, seen, candidates);
    findHostCandidates(ctx, seen, candidates);
    if (ctx.language === "html") {
      findHtmlScriptCandidates(ctx.ast as HtmlDocument, ctx.filePath, seen, candidates);
    }
    return candidates;
  },
});

function findImportCandidates(
  ctx: RuleContext,
  seen: Set<string>,
  candidates: ReviewCandidate[],
): void {
  for (const pkg of CAPTCHA_PACKAGES) {
    const pattern = new RegExp(`(?:from|require\\s*\\()\\s*["'\`]${escapeRegExp(pkg)}["'\`]`, "g");
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      emitSourceCandidate(ctx, seen, candidates, offset, `imports CAPTCHA library "${pkg}"`);
    }
  }
}

function findComponentCandidates(
  ctx: RuleContext,
  seen: Set<string>,
  candidates: ReviewCandidate[],
): void {
  if (ctx.language !== "tsx" && ctx.language !== "jsx") return;
  for (const tag of CAPTCHA_COMPONENT_TAGS) {
    const pattern = new RegExp(`<${escapeRegExp(tag)}\\b`, "g");
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      emitSourceCandidate(ctx, seen, candidates, offset, `renders <${tag}> component`);
    }
  }
}

function findHostCandidates(
  ctx: RuleContext,
  seen: Set<string>,
  candidates: ReviewCandidate[],
): void {
  for (const host of CAPTCHA_HOSTS) {
    let from = 0;
    while (from < ctx.source.length) {
      const offset = ctx.source.indexOf(host, from);
      if (offset === -1) break;
      emitSourceCandidate(
        ctx,
        seen,
        candidates,
        offset,
        `references CAPTCHA vendor host "${host}"`,
      );
      from = offset + host.length;
    }
  }
}

function findHtmlScriptCandidates(
  root: HtmlDocument,
  filePath: string,
  seen: Set<string>,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    if (el.tagName.toLowerCase() !== "script") continue;
    const src = getHtmlAttribute(el, "src");
    if (!src) continue;
    const matchedHost = CAPTCHA_HOSTS.find((h) => src.includes(h));
    if (!matchedHost) continue;
    const key = `${el.loc.start.line}:${el.loc.start.column}:script`;
    if (seen.has(key)) continue;
    seen.add(key);
    pushForAllCriteria(
      candidates,
      filePath,
      el.loc.start.line,
      el.loc.start.column,
      `<script src> loads CAPTCHA vendor host "${matchedHost}"`,
    );
  }
}

function emitSourceCandidate(
  ctx: RuleContext,
  seen: Set<string>,
  candidates: ReviewCandidate[],
  offset: number,
  reasonCore: string,
): void {
  const { line, column } = offsetToLineColumn(ctx.source, offset);
  const key = `${line}:${column}:${reasonCore}`;
  if (seen.has(key)) return;
  seen.add(key);
  pushForAllCriteria(candidates, ctx.filePath, line, column, reasonCore);
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  reasonCore: string,
): void {
  const reason = `${reasonCore} — verify the authentication flow also offers a non-cognitive alternative (WebAuthn, hardware token, email magic link)`;
  for (const criterionId of CRITERION_IDS) {
    // Confidence "high": known CAPTCHA package names, vendor hostnames,
    // and widget component tags are single-purpose signals — the
    // element IS a CAPTCHA. The reviewer question is about the sibling
    // alternative, not whether this is really a CAPTCHA.
    candidates.push({
      criterionId,
      location: { filePath, line, column },
      reason,
      confidence: "high",
    });
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
