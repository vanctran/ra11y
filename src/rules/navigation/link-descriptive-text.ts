/**
 * Rule: navigation/link-descriptive-text
 * Satisfies: wcag22:2.4.4, wcag21:2.4.4
 * Spec: https://www.w3.org/TR/WCAG22/#link-purpose-in-context
 *
 * > The purpose of each link can be determined from the link text alone
 * > or from the link text together with its programmatically determined
 * > link context.
 *
 * Source: https://www.w3.org/TR/WCAG22/#link-purpose-in-context
 *
 * Flags <a href> (HTML) and <a>/<Link>/<NavLink> (JSX) elements whose
 * text content is a known non-descriptive phrase: "click here", "here",
 * "read more", "more", "link", "this link", "click", etc. These phrases
 * tell a screen-reader user nothing about where they'll end up when the
 * link is read out of context — and screen readers DO read links out of
 * context (Tab, VoiceOver rotor, etc.).
 *
 * Rule ignores links that have an accessible name override via
 * aria-label or aria-labelledby — assume the developer is providing a
 * better name via ARIA even if the visible text is generic.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  htmlTextContent,
  jsxTextContent,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  JsxElement,
  TsxModule,
} from "../../types/ast.ts";

/**
 * Phrases that are never acceptable as link text on their own. Matched
 * case-insensitively after trimming trailing punctuation. Curated list
 * — overzealous matching here burns user trust, so we keep it tight.
 */
const GENERIC_PHRASES: ReadonlySet<string> = new Set([
  "click here",
  "click",
  "here",
  "read more",
  "more",
  "link",
  "this link",
  "this",
  "more info",
  "more information",
  "details",
  "learn more",
]);

/** JSX tags that represent a link. Covers the common React router libs. */
const JSX_LINK_TAGS: ReadonlySet<string> = new Set([
  "a",
  "Link",
  "NavLink",
  "Anchor",
]);

export const rule = defineRule({
  id: "navigation/link-descriptive-text",
  satisfies: ["wcag22:2.4.4", "wcag21:2.4.4"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Link text must describe the link's destination or purpose, not generic phrases like 'click here' or 'read more'.",
    rationale:
      "Screen readers read links out of context — users scan the links list, Tab through them, or use the VoiceOver rotor. A link that says 'here' tells users nothing about where it goes. Descriptive link text also helps sighted users scanning a page and improves SEO.",
    goodExample: `<a href="/docs/api">Read the API reference</a>`,
    badExample: `<a href="/docs/api">Click here</a>`,
    normativeQuote:
      "The purpose of each link can be determined from the link text alone or from the link text together with its programmatically determined link context.",
    references: [
      "https://www.w3.org/TR/WCAG22/#link-purpose-in-context",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G91",
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

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const a of findHtmlElementsByTag(doc, "a")) {
    if (!hasHtmlAttribute(a, "href")) continue;
    if (hasAccessibleNameOverrideHtml(a)) continue;

    const text = htmlTextContent(a);
    const generic = matchesGenericPhrase(text);
    if (!generic) continue;

    emit({
      severity: "warning",
      location: {
        filePath: "",
        line: a.loc.start.line,
        column: a.loc.start.column,
      },
      message: `Link text "${generic}" is not descriptive — screen readers reading this out of context tell users nothing about where they'll end up.`,
      suggestion: buildSuggestion(getHtmlAttribute(a, "href"), generic),
    });
  }
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const tag of JSX_LINK_TAGS) {
    for (const el of findJsxElementsByTag(module, tag)) {
      if (hasAccessibleNameOverrideJsx(el)) continue;
      // Only check link-style elements with href/to props.
      if (!hasJsxAttribute(el, "href") && !hasJsxAttribute(el, "to")) continue;
      const text = jsxTextContent(el);
      const generic = matchesGenericPhrase(text);
      if (!generic) continue;
      emit({
        severity: "warning",
        location: {
          filePath: "",
          line: el.loc.start.line,
          column: el.loc.start.column,
        },
        message: `<${tag}> text "${generic}" is not descriptive — screen readers reading this out of context tell users nothing about where they'll end up.`,
        suggestion: buildSuggestion(
          getJsxAttributeString(el, "href") ?? getJsxAttributeString(el, "to"),
          generic,
        ),
      });
    }
  }
}

function hasAccessibleNameOverrideHtml(el: HtmlElement): boolean {
  const ariaLabel = getHtmlAttribute(el, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasHtmlAttribute(el, "aria-labelledby")) return true;
  return false;
}

function hasAccessibleNameOverrideJsx(el: JsxElement): boolean {
  const ariaLabel = getJsxAttributeString(el, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasJsxAttribute(el, "aria-labelledby")) return true;
  return false;
}

function matchesGenericPhrase(text: string): string | null {
  const normalized = text
    .trim()
    .toLowerCase()
    // Strip trailing punctuation and arrows so "Click here →" still matches.
    .replace(/[.!?→>»…]+$/u, "")
    .trim();
  if (normalized.length === 0) return null;
  if (GENERIC_PHRASES.has(normalized)) return normalized;
  return null;
}

function buildSuggestion(href: string | null, phrase: string): string {
  if (!href) {
    return `Replace "${phrase}" with text that describes what the link does, e.g. "View the API reference" instead of "Click here".`;
  }
  const destination = destinationHint(href);
  if (destination) {
    return `Replace "${phrase}" with text that describes the destination, e.g. "View ${destination}". Alternatively, add an aria-label describing the link's purpose.`;
  }
  return `Replace "${phrase}" with a destination-describing phrase, or add an aria-label.`;
}

function destinationHint(href: string): string {
  // Turn "/docs/api-reference" into "api reference" so the suggestion
  // reads like a real user-facing link title.
  const cleaned = href
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/^\//, "")
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .split("/")
    .pop() ?? "";
  return cleaned.replace(/[-_]+/g, " ").trim();
}
