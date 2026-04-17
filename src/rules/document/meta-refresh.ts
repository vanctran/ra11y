/**
 * Rule: document/meta-refresh
 * Satisfies: wcag22:2.2.1, wcag21:2.2.1, wcag22:2.2.4, wcag21:2.2.4,
 *            wcag22:3.2.5, wcag21:3.2.5
 * Spec: https://www.w3.org/TR/WCAG22/#timing-adjustable
 *       https://www.w3.org/TR/WCAG22/#interruptions
 *       https://www.w3.org/TR/WCAG22/#change-on-request
 *
 * > For each time limit that is set by the content, at least one of the
 * > following is true: Turn off; Adjust; Extend; Real-time Exception;
 * > Essential Exception; 20 Hour Exception.
 *
 * Source: https://www.w3.org/TR/WCAG22/#timing-adjustable
 *
 * Flags `<meta http-equiv="refresh" content="N; url=...">` with N > 0
 * (auto-redirect after delay) and `<meta http-equiv="refresh" content="N">`
 * with N > 0 (auto-reload after delay). Both impose an uncontrollable
 * time limit and/or an unexpected change of context — classic failures
 * of SC 2.2.1 (Timing Adjustable), 2.2.4 (Interruptions), and 3.2.5
 * (Change on Request).
 *
 * `content="0; url=..."` is a common server-side-redirect surrogate.
 * It's allowed by WCAG as a technique note but strongly discouraged —
 * we flag it as a warning recommending an actual HTTP redirect.
 */

import { defineRule } from "../../api/plugin.ts";
import { findHtmlElementsByTag, getHtmlAttribute } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";

export const rule = defineRule({
  id: "document/meta-refresh",
  satisfies: [
    "wcag22:2.2.1",
    "wcag21:2.2.1",
    "wcag22:2.2.4",
    "wcag21:2.2.4",
    "wcag22:3.2.5",
    "wcag21:3.2.5",
  ],
  severity: "error",
  scope: "document",
  fixClass: "mechanical",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "<meta http-equiv='refresh'> must not auto-redirect or auto-reload after a delay. Users can't turn off, adjust, or extend the timer, and the page changes context without warning.",
    rationale:
      "A meta refresh with a non-zero delay imposes a time limit the user cannot control — failing WCAG 2.2.1 (Timing Adjustable). It also triggers an unexpected change of context, failing 3.2.5. Screen reader users may be mid-sentence when the page reloads or navigates; motor-impaired users may not finish reading. The fix is a server-side HTTP redirect, or a link the user activates intentionally.",
    goodExample: `<link rel="canonical" href="/new-page">
<!-- Paired with a 301/302 server-side redirect, not a meta refresh. -->`,
    badExample: `<meta http-equiv="refresh" content="5; url=/new-page">`,
    normativeQuote:
      "For each time limit that is set by the content, at least one of the following is true: Turn off; Adjust; Extend; Real-time Exception; Essential Exception; 20 Hour Exception.",
    references: [
      "https://www.w3.org/TR/WCAG22/#timing-adjustable",
      "https://www.w3.org/TR/WCAG22/#interruptions",
      "https://www.w3.org/TR/WCAG22/#change-on-request",
      "https://www.w3.org/WAI/WCAG22/Techniques/failures/F40",
      "https://www.w3.org/WAI/WCAG22/Techniques/failures/F41",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    for (const meta of findHtmlElementsByTag(doc, "meta")) {
      const httpEquiv = getHtmlAttribute(meta, "http-equiv")?.toLowerCase();
      if (httpEquiv !== "refresh") continue;
      const content = getHtmlAttribute(meta, "content");
      if (content === null) continue;
      const parsed = parseRefreshContent(content);
      if (parsed === null) continue;
      const violation = buildViolation(meta, parsed);
      ctx.emit(violation);
    }
  },
});

interface ParsedRefresh {
  readonly delaySeconds: number;
  readonly targetUrl: string | null;
}

/**
 * Parses a meta-refresh `content` attribute. Returns null when the
 * content isn't recognizably a refresh directive — we only flag when
 * we can definitively identify the timer.
 *
 * Shape: `<seconds>` or `<seconds>; url=<target>` (case-insensitive).
 */
function parseRefreshContent(content: string): ParsedRefresh | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  const semi = trimmed.indexOf(";");
  const delayToken = (semi === -1 ? trimmed : trimmed.slice(0, semi)).trim();
  if (delayToken.length === 0) return null;
  if (!/^\d+(?:\.\d+)?$/.test(delayToken)) return null;
  const delaySeconds = Number.parseFloat(delayToken);
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return null;
  if (semi === -1) {
    return { delaySeconds, targetUrl: null };
  }
  const rest = trimmed.slice(semi + 1).trim();
  const targetUrl = extractUrl(rest);
  return { delaySeconds, targetUrl };
}

/**
 * Extracts the target URL from the portion after the semicolon. The
 * canonical form is `url=<target>` (case-insensitive, optionally
 * quoted). If we can't find a `url=` token we still return whatever
 * trailing text remains, because some browsers accept a bare URL.
 */
function extractUrl(rest: string): string | null {
  if (rest.length === 0) return null;
  const match = rest.match(/^url\s*=\s*(.*)$/i);
  const raw = match ? (match[1] ?? "") : rest;
  const unquoted = stripQuotes(raw.trim());
  return unquoted.length === 0 ? null : unquoted;
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}

function buildViolation(
  meta: HtmlElement,
  parsed: ParsedRefresh,
): {
  severity: "error" | "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  const location = {
    filePath: "",
    line: meta.loc.start.line,
    column: meta.loc.start.column,
  };
  if (parsed.delaySeconds === 0) {
    return {
      severity: "warning",
      location,
      message: parsed.targetUrl
        ? `<meta http-equiv="refresh" content="0; url=${parsed.targetUrl}"> uses an instant client-side redirect — assistive tech can mishandle it, and it bypasses the browser's history/back-button semantics.`
        : `<meta http-equiv="refresh" content="0"> immediately reloads the page via the client — a server-side response is strongly preferred.`,
      suggestion: parsed.targetUrl
        ? `Replace this meta refresh with a real server-side HTTP 301/302 redirect to ${parsed.targetUrl}. If you cannot control the server, at minimum keep the delay at 0 and provide a visible link the user can follow: <a href="${parsed.targetUrl}">Continue to ${parsed.targetUrl}</a>.`
        : `Remove the meta refresh. If the page needs to change, use a server-side redirect or a user-activated link.`,
    };
  }
  const seconds = parsed.delaySeconds;
  if (parsed.targetUrl !== null) {
    return {
      severity: "error",
      location,
      message: `<meta http-equiv="refresh" content="${seconds}; url=${parsed.targetUrl}"> auto-navigates after ${seconds}s. Users can't turn off, adjust, or extend this timer — fails WCAG 2.2.1 (Timing Adjustable) and 3.2.5 (Change on Request).`,
      suggestion: `Remove the meta refresh and use a server-side HTTP redirect (301/302), or replace it with an explicit link: <a href="${parsed.targetUrl}">Go to ${parsed.targetUrl}</a>. Never auto-navigate on a timer.`,
    };
  }
  return {
    severity: "error",
    location,
    message: `<meta http-equiv="refresh" content="${seconds}"> auto-reloads the page every ${seconds}s. Users can't pause or extend the timer — fails WCAG 2.2.1 (Timing Adjustable) and 2.2.4 (Interruptions).`,
    suggestion: `Remove the meta refresh. If the page shows live data, fetch updates in-place via JavaScript and give users a visible pause/resume control. Never force a full reload on a timer.`,
  };
}
