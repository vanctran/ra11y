/**
 * Candidate finder: review/motion-actuation
 * Criteria: wcag22:2.5.4, wcag21:2.5.4, section508:1194.21.c, en301549:9.2.5.4
 * Spec: https://www.w3.org/TR/WCAG22/#motion-actuation
 *
 * Surfaces locations that listen to device motion or orientation. If the
 * site invokes any functionality in response to these events, WCAG 2.5.4
 * requires that (a) the functionality also be operable via a UI component
 * and (b) motion response be disable-able. A static scan cannot verify
 * the alternative UI exists or the disable mechanism is present — only
 * a human reviewer can.
 *
 * Signal is tight: `DeviceMotionEvent`, `DeviceOrientationEvent`, and
 * their lowercase listener strings have no other purpose in web code.
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { walkHtmlElements } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { RuleContext } from "../../types/rule.ts";

const CRITERION_IDS = [
  "wcag22:2.5.4",
  "wcag21:2.5.4",
  "section508:1194.21.c",
  "en301549:9.2.5.4",
] as const;

/**
 * Source patterns that indicate device-motion or device-orientation
 * wiring. Each pattern must be specific enough that no common
 * non-motion code matches it.
 */
const SOURCE_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  {
    pattern:
      /addEventListener\s*\(\s*["'`](devicemotion|deviceorientation|deviceorientationabsolute)["'`]/g,
    label: 'addEventListener("$1")',
  },
  {
    pattern: /\b(on(?:devicemotion|deviceorientation|deviceorientationabsolute))\s*=/g,
    label: "window.$1 assignment",
  },
  {
    pattern: /\b(DeviceMotionEvent|DeviceOrientationEvent)\b/g,
    label: "$1 reference",
  },
] as const;

const HTML_MOTION_ATTRS: readonly string[] = [
  "ondevicemotion",
  "ondeviceorientation",
  "ondeviceorientationabsolute",
];

export const finder = defineCandidateFinder({
  id: "review/motion-actuation",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      "Finds device-motion and device-orientation event wiring. Any site using these APIs must provide a UI-based alternative and a mechanism to disable the motion response.",
    reviewPrompt:
      "Verify that every feature triggered by device motion or orientation can also be triggered by a UI control (button, gesture, menu), and that the user can disable motion response. If the API is used only for a decorative effect, confirm it degrades gracefully when motion is blocked by the user agent.",
    references: [
      "https://www.w3.org/TR/WCAG22/#motion-actuation",
      "https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, candidates);
    }
    findSourceCandidates(ctx, candidates);
    return candidates;
  },
});

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    const matched = matchedMotionAttr(el);
    if (!matched) continue;
    candidates.push({
      criterionId: CRITERION_IDS[0],
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason: `<${el.tagName}> defines ${matched} — verify the feature is also operable via a UI control and that motion response can be disabled`,
    });
    // Emit for each cross-standard equivalent.
    for (let i = 1; i < CRITERION_IDS.length; i++) {
      const id = CRITERION_IDS[i];
      if (id === undefined) continue;
      candidates.push({
        criterionId: id,
        location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
        reason: `<${el.tagName}> defines ${matched} — verify the feature is also operable via a UI control and that motion response can be disabled`,
      });
    }
  }
}

function matchedMotionAttr(el: HtmlElement): string | undefined {
  for (const attr of el.attributes) {
    const name = attr.name.toLowerCase();
    if (HTML_MOTION_ATTRS.includes(name)) return name;
  }
  return undefined;
}

function findSourceCandidates(ctx: RuleContext, candidates: ReviewCandidate[]): void {
  const seen = new Set<number>();
  for (const { pattern, label } of SOURCE_PATTERNS) {
    // Regex is /g; reset before reuse to avoid cross-call state.
    pattern.lastIndex = 0;
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      if (seen.has(offset)) continue;
      seen.add(offset);
      const { line, column } = offsetToLineColumn(ctx.source, offset);
      const rendered = renderLabel(label, match);
      for (const criterionId of CRITERION_IDS) {
        candidates.push({
          criterionId,
          location: { filePath: ctx.filePath, line, column },
          reason: `${rendered} — verify the feature is also operable via a UI control and that motion response can be disabled`,
        });
      }
    }
  }
}

function renderLabel(label: string, match: RegExpMatchArray): string {
  const token = match[1] ?? match[0];
  return label.replace("$1", token);
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
