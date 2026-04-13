/**
 * Rule: aria/live-region-valid
 * Satisfies: wcag22:4.1.3, wcag21:4.1.3
 * Spec: https://www.w3.org/TR/WCAG22/#status-messages
 * ARIA: https://www.w3.org/TR/wai-aria-1.2/#aria-live
 *
 * > In content implemented using markup languages, status messages can
 * > be programmatically determined through role or properties such that
 * > they can be presented to the user by assistive technologies without
 * > receiving focus.
 *
 * Source: https://www.w3.org/TR/WCAG22/#status-messages
 *
 * Validates that author-declared live regions are well-formed. A
 * malformed live region silently fails: the screen reader treats the
 * attribute as absent and the status update is never announced. Static
 * analysis cannot tell whether a runtime mutation will actually appear
 * in a live region, but it CAN flag the cases where the declaration
 * itself is broken — invalid token values and contradictions between
 * implicit role politeness and an explicit `aria-live`.
 *
 * Checks performed:
 *   1. `aria-live` value is one of `off`, `polite`, `assertive`.
 *   2. `aria-atomic` value is `true` or `false`.
 *   3. `aria-relevant` tokens are a subset of `additions removals text all`.
 *   4. `role="status"` (implicit polite) does not pair with `aria-live="assertive"`.
 *   5. `role="alert"` (implicit assertive) does not pair with `aria-live="polite"`.
 *   6. An element with `aria-live` (or a live-region role) does not also have
 *      `aria-hidden="true"` — announcements are suppressed inside hidden subtrees.
 *
 * Out of scope (deliberately): detecting whether the element is mounted
 * with initial content vs. populated dynamically. React components
 * frequently re-render, and a content-presence heuristic produces too
 * many false positives to be useful.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

/** Valid `aria-live` values per WAI-ARIA 1.2. */
const VALID_ARIA_LIVE: ReadonlySet<string> = new Set(["off", "polite", "assertive"]);

/** Valid `aria-atomic` values per WAI-ARIA 1.2. */
const VALID_ARIA_ATOMIC: ReadonlySet<string> = new Set(["true", "false"]);

/** Valid `aria-relevant` tokens per WAI-ARIA 1.2. */
const VALID_ARIA_RELEVANT_TOKENS: ReadonlySet<string> = new Set([
  "additions",
  "removals",
  "text",
  "all",
]);

/**
 * Roles whose definition implies a live region, mapped to the
 * politeness setting they imply. See WAI-ARIA 1.2 §5.3.5.
 */
type ImpliedPoliteness = "off" | "polite" | "assertive";

const LIVE_ROLE_POLITENESS: ReadonlyMap<string, ImpliedPoliteness> = new Map<
  string,
  ImpliedPoliteness
>([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
  ["timer", "off"],
  ["marquee", "off"],
]);

export const rule = defineRule({
  id: "aria/live-region-valid",
  satisfies: ["wcag22:4.1.3", "wcag21:4.1.3"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Live region declarations must use valid ARIA token values, and an explicit aria-live must not contradict the politeness implied by a live-region role.",
    rationale:
      'Status messages are announced to screen reader users via live regions. If aria-live, aria-atomic, or aria-relevant carries an invalid token, assistive tech treats the attribute as absent and the status update is silently dropped. Likewise, pairing role="status" (implicitly polite) with aria-live="assertive" is contradictory: some screen readers honor the role, others honor the attribute, and the resulting behavior is unpredictable. Catching these declarations statically prevents announcements that authors intend but never reach the user.',
    goodExample: `<div role="status" aria-atomic="true">Saved.</div>`,
    badExample: `<div role="status" aria-live="assertive">Saved.</div>`,
    normativeQuote:
      "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.",
    references: [
      "https://www.w3.org/TR/WCAG22/#status-messages",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-live",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-atomic",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-relevant",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Loc = { readonly line: number; readonly column: number };

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

interface Attrs {
  readonly tagName: string;
  readonly loc: Loc;
  readonly ariaLive: string | null;
  readonly ariaAtomic: string | null;
  readonly ariaRelevant: string | null;
  readonly ariaHidden: string | null;
  readonly role: string | null;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const el of walkHtmlElements(doc)) {
    checkAttrs(htmlAttrs(el), emit);
  }
}

function htmlAttrs(el: HtmlElement): Attrs {
  return {
    tagName: el.tagName,
    loc: el.loc.start,
    ariaLive: getHtmlAttribute(el, "aria-live"),
    ariaAtomic: getHtmlAttribute(el, "aria-atomic"),
    ariaRelevant: getHtmlAttribute(el, "aria-relevant"),
    ariaHidden: getHtmlAttribute(el, "aria-hidden"),
    role: getHtmlAttribute(el, "role"),
  };
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const el of walkJsxElements(module)) {
    checkAttrs(jsxAttrs(el), emit);
  }
}

function jsxAttrs(el: JsxElement): Attrs {
  return {
    tagName: el.tagName,
    loc: el.loc.start,
    ariaLive: getJsxAttributeString(el, "aria-live"),
    ariaAtomic: getJsxAttributeString(el, "aria-atomic"),
    ariaRelevant: getJsxAttributeString(el, "aria-relevant"),
    ariaHidden: getJsxAttributeString(el, "aria-hidden"),
    role: getJsxAttributeString(el, "role"),
  };
}

// ---------------------------------------------------------------------------
// Shared logic
// ---------------------------------------------------------------------------

function checkAttrs(a: Attrs, emit: Emit): void {
  const role = a.role === null ? null : a.role.toLowerCase();
  const implicit = role === null ? null : (LIVE_ROLE_POLITENESS.get(role) ?? null);
  const liveOk = checkAriaLive(a, role, implicit, emit);
  if (!liveOk) return;
  checkAriaAtomic(a, emit);
  checkAriaRelevant(a, emit);
  checkHidden(a, implicit, emit);
}

/** Returns false when aria-live itself is invalid (skip remaining checks). */
function checkAriaLive(
  a: Attrs,
  role: string | null,
  implicit: ImpliedPoliteness | null,
  emit: Emit,
): boolean {
  if (a.ariaLive === null) return true;
  const lowered = a.ariaLive.toLowerCase();
  if (!VALID_ARIA_LIVE.has(lowered)) {
    emit(buildInvalidLive(a, a.ariaLive));
    return false;
  }
  if (role !== null && implicit !== null) {
    const contradiction = detectContradiction(a, role, implicit, lowered);
    if (contradiction !== null) emit(contradiction);
  }
  return true;
}

function checkAriaAtomic(a: Attrs, emit: Emit): void {
  if (a.ariaAtomic === null) return;
  if (VALID_ARIA_ATOMIC.has(a.ariaAtomic.toLowerCase())) return;
  emit(buildInvalidAtomic(a, a.ariaAtomic));
}

function checkAriaRelevant(a: Attrs, emit: Emit): void {
  if (a.ariaRelevant === null) return;
  const invalidToken = firstInvalidRelevantToken(a.ariaRelevant);
  if (invalidToken !== null) emit(buildInvalidRelevant(a, invalidToken));
}

function checkHidden(a: Attrs, implicit: ImpliedPoliteness | null, emit: Emit): void {
  const isLiveRegion = a.ariaLive !== null || implicit !== null;
  if (!isLiveRegion) return;
  if (a.ariaHidden === null) return;
  if (a.ariaHidden.toLowerCase() !== "true") return;
  emit(buildHiddenLiveRegion(a));
}

function detectContradiction(
  a: Attrs,
  role: string,
  implicit: ImpliedPoliteness,
  explicit: string,
): ReturnType<typeof buildContradiction> | null {
  if (implicit === "off") return null;
  if (implicit === explicit) return null;
  // Treat "off" on a live role as the author silencing it — still suspect,
  // but we only flag the alert/status polite-vs-assertive contradiction.
  if (explicit === "off") return null;
  if (role === "status" && explicit === "assertive") {
    return buildContradiction(a, role, explicit, "polite");
  }
  if (role === "alert" && explicit === "polite") {
    return buildContradiction(a, role, explicit, "assertive");
  }
  if (role === "log" && explicit === "assertive") {
    return buildContradiction(a, role, explicit, "polite");
  }
  return null;
}

/**
 * Returns the first token in an `aria-relevant` value that is not in
 * the WAI-ARIA token set, or null if every token is valid. An empty
 * value (`aria-relevant=""`) is treated as invalid because the spec
 * requires at least one token; browsers fall back to the default
 * `additions text` rather than honoring the empty list.
 */
function firstInvalidRelevantToken(value: string): string | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return "";
  for (const tok of tokens) {
    if (!VALID_ARIA_RELEVANT_TOKENS.has(tok.toLowerCase())) return tok;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Violation builders — each fix suggestion names the offending tag and
// attribute combination so the message is actionable in isolation.
// ---------------------------------------------------------------------------

function buildInvalidLive(
  a: Attrs,
  raw: string,
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: a.loc.line, column: a.loc.column },
    message: `<${a.tagName}> has aria-live="${raw}", which is not a valid ARIA live-region value — assistive tech will ignore the attribute and the status update will not be announced.`,
    suggestion: `Use one of "off", "polite", or "assertive". For routine status updates use "polite"; reserve "assertive" for time-critical alerts (errors, expiring sessions). If you don't need announcements, remove aria-live entirely.`,
  };
}

function buildInvalidAtomic(
  a: Attrs,
  raw: string,
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: a.loc.line, column: a.loc.column },
    message: `<${a.tagName}> has aria-atomic="${raw}", which is not a valid value — assistive tech will treat the attribute as absent and may announce only the changed text node instead of the whole region.`,
    suggestion: `aria-atomic accepts only "true" (announce the entire region on update) or "false" (announce only the changed nodes — the default). Replace "${raw}" with one of those literal strings.`,
  };
}

function buildInvalidRelevant(
  a: Attrs,
  badToken: string,
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  if (badToken === "") {
    return {
      severity: "error",
      location: { filePath: "", line: a.loc.line, column: a.loc.column },
      message: `<${a.tagName}> has an empty aria-relevant value — the spec requires at least one token, so assistive tech falls back to the default "additions text" and the explicit declaration is wasted.`,
      suggestion: `Either remove aria-relevant (the default "additions text" is almost always what you want), or set it to a space-separated list of "additions", "removals", "text", or "all".`,
    };
  }
  return {
    severity: "error",
    location: { filePath: "", line: a.loc.line, column: a.loc.column },
    message: `<${a.tagName}> has aria-relevant token "${badToken}", which is not in the ARIA-defined token set — the entire attribute is ignored by some screen readers and the announcement scope reverts to the default.`,
    suggestion: `aria-relevant tokens must be drawn from "additions", "removals", "text", or "all" (space-separated). Remove or rename "${badToken}".`,
  };
}

function buildContradiction(
  a: Attrs,
  role: string,
  explicit: string,
  implicit: "polite" | "assertive",
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: a.loc.line, column: a.loc.column },
    message: `<${a.tagName}> has aria-live="${explicit}" but role="${role}" (which implies ${implicit}) — different screen readers resolve the conflict differently and announcements become unpredictable.`,
    suggestion:
      role === "status" && explicit === "assertive"
        ? `Either keep role="status" and remove the explicit aria-live (status already supplies the polite default), or switch to role="alert" if the message is time-critical and must interrupt.`
        : role === "alert" && explicit === "polite"
          ? `Either keep role="alert" and remove the explicit aria-live (alert already supplies the assertive default), or switch to role="status" if the message should not interrupt the current announcement.`
          : `Either keep role="${role}" and remove the explicit aria-live (the role already supplies ${implicit}), or replace the role with a non-live container if you need a different politeness.`,
  };
}

function buildHiddenLiveRegion(a: Attrs): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: a.loc.line, column: a.loc.column },
    message: `<${a.tagName}> declares a live region but also has aria-hidden="true" — the subtree is removed from the accessibility tree, so updates to it are never announced.`,
    suggestion: `Remove aria-hidden from this element. Live regions must remain in the accessibility tree to be announced; use CSS (clip-path, sr-only utility) if you need to hide it visually while keeping it readable to assistive tech.`,
  };
}
