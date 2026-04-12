/**
 * Rule: document/viewport-zoom
 * Satisfies: wcag22:1.4.4, wcag21:1.4.4, wcag22:1.4.10, wcag21:1.4.10
 * Spec: https://www.w3.org/TR/WCAG22/#resize-text
 *       https://www.w3.org/TR/WCAG22/#reflow
 *
 * > Except for captions and images of text, text can be resized
 * > without assistive technology up to 200 percent without loss of
 * > content or functionality.
 *
 * Source: https://www.w3.org/TR/WCAG22/#resize-text
 *
 * Flags `<meta name="viewport">` tags whose `content` attribute
 * disables pinch-to-zoom or caps the scale at <2x. Common offenders:
 *
 *   user-scalable=no        — hard-blocks zoom entirely
 *   user-scalable=0         — alias for no
 *   maximum-scale=1.0       — effectively blocks zoom at default scale
 *   maximum-scale=1         — same
 *
 * Users with low vision rely on pinch-to-zoom to read content. A
 * "user-scalable=no" meta tag is so harmful that Safari on iOS ignores
 * it in some accessibility modes — but no browser ignores it
 * universally, so we still flag it.
 */

import { defineRule } from "../../api/plugin.ts";
import { findHtmlElementsByTag, getHtmlAttribute } from "../../engine/ast-helpers.ts";
import type { HtmlDocument } from "../../types/ast.ts";

export const rule = defineRule({
  id: "document/viewport-zoom",
  satisfies: ["wcag22:1.4.4", "wcag21:1.4.4"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "<meta name='viewport'> must not disable pinch-to-zoom. Avoid user-scalable=no and maximum-scale values below 2.",
    rationale:
      "Users with low vision rely on pinch-to-zoom to read content. A viewport meta tag that disables scaling — or caps it below 200% — makes the page unreadable for them. WCAG 1.4.4 requires text to be resizable up to 200% without loss of content; 1.4.10 requires reflow at 400% on mobile.",
    goodExample: `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    badExample: `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`,
    normativeQuote:
      "Text can be resized without assistive technology up to 200 percent without loss of content or functionality.",
    references: [
      "https://www.w3.org/TR/WCAG22/#resize-text",
      "https://www.w3.org/TR/WCAG22/#reflow",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    for (const meta of findHtmlElementsByTag(doc, "meta")) {
      const name = getHtmlAttribute(meta, "name")?.toLowerCase();
      if (name !== "viewport") continue;
      const content = getHtmlAttribute(meta, "content");
      if (content === null) continue;
      const problems = analyzeViewportContent(content);
      for (const problem of problems) {
        ctx.emit({
          severity: "error",
          location: {
            filePath: "",
            line: meta.loc.start.line,
            column: meta.loc.start.column,
          },
          message: problem.message,
          suggestion: problem.suggestion,
        });
      }
    }
  },
});

interface ViewportProblem {
  readonly message: string;
  readonly suggestion: string;
}

function analyzeViewportContent(content: string): readonly ViewportProblem[] {
  const parts = content
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const props = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    props.set(key, value);
  }
  const problems: ViewportProblem[] = [];
  const userScalable = props.get("user-scalable");
  if (userScalable === "no" || userScalable === "0") {
    problems.push({
      message: `<meta name="viewport"> sets user-scalable=${userScalable}, which disables pinch-to-zoom entirely.`,
      suggestion: `Remove user-scalable=no. Low-vision users rely on pinch-to-zoom to read — this flag locks them out. A safer viewport is: content="width=device-width, initial-scale=1".`,
    });
  }
  const maxScale = props.get("maximum-scale");
  if (maxScale !== undefined) {
    const parsed = Number.parseFloat(maxScale);
    if (Number.isFinite(parsed) && parsed < 2) {
      problems.push({
        message: `<meta name="viewport"> sets maximum-scale=${maxScale}, capping zoom below 200% — users can't meet WCAG 1.4.4's resize-text requirement.`,
        suggestion: `Remove maximum-scale, or set it to at least 2. WCAG 1.4.4 requires text to be resizable to 200% without loss of content.`,
      });
    }
  }
  return problems;
}
