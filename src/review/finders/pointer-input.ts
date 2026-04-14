/**
 * Candidate finder: review/pointer-input
 * Criteria: wcag22:2.5.1 (pointer gestures, A)
 *           wcag22:2.5.6 (concurrent input mechanisms, AAA)
 *
 * Spec:  https://www.w3.org/TR/WCAG22/#pointer-gestures
 *        https://www.w3.org/TR/WCAG22/#concurrent-input-mechanisms
 *
 * Surfaces uses of path-based / multipoint pointer and touch event
 * handlers. Both criteria are reviewer questions, not mechanical checks:
 * 2.5.1 asks whether gesture-driven behavior also works with a single
 * click / tap, and 2.5.6 asks whether the interface silently restricts
 * input to one modality when multiple are available. Neither can be
 * decided from a handler name alone — the reviewer reads what the
 * handler does.
 *
 * Per CLAUDE.md §1 we surface; we don't guess whether a `onPointerMove`
 * is the path stroke of a signature pad (gesture-required — likely
 * real 2.5.1 issue) or a hover-tooltip trigger (no gesture — fine).
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { walkJsxElements } from "../../engine/ast-helpers.ts";
import type { TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { RuleContext } from "../../types/rule.ts";

const CRITERION_IDS = ["wcag22:2.5.1", "wcag21:2.5.1", "wcag22:2.5.6", "wcag21:2.5.6"] as const;

/**
 * JSX event-handler attribute names that indicate path-based,
 * multipoint, or touch-only interaction. Point-in-time handlers like
 * onClick / onPointerDown are NOT listed — they work with any pointer.
 */
const GESTURE_HANDLERS: ReadonlySet<string> = new Set([
  "onPointerMove",
  "onTouchMove",
  "onGestureStart",
  "onGestureChange",
  "onGestureEnd",
  "onTouchStart",
  "onTouchEnd",
  "onTouchCancel",
]);

/**
 * Source-text patterns for DOM-event listener registration from non-JSX
 * TS/JS code (addEventListener calls, Web API event names used as
 * property handlers). Complements the JSX walk.
 */
const SOURCE_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  {
    pattern:
      /addEventListener\s*\(\s*['"`](pointermove|touchmove|gesturestart|gesturechange|gestureend|touchstart|touchend|touchcancel)['"`]/g,
    label: "addEventListener('$1')",
  },
];

const GESTURE_REASON =
  " — verify the interaction also works with a single-point input (click/tap) and that the interface does not restrict the user to a single input mechanism";

export const finder = defineCandidateFinder({
  id: "review/pointer-input",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".tsx", ".jsx", ".ts", ".js"] },
  docs: {
    description:
      "Finds path-based/multipoint pointer and touch event handlers (onPointerMove, onTouchMove, gesture events) — signals of gesture-driven UI that must offer a single-pointer alternative (2.5.1) and support concurrent input modalities (2.5.6).",
    reviewPrompt:
      "At each handler, determine what the interaction does. If the user can only achieve the outcome through a path, swipe, pinch, or multi-finger gesture, verify a single-pointer alternative exists (2.5.1). If the handler restricts input to touch only — no equivalent mouse/keyboard path — verify that's intended, else add the alternative (2.5.6).",
    references: [
      "https://www.w3.org/TR/WCAG22/#pointer-gestures",
      "https://www.w3.org/TR/WCAG22/#concurrent-input-mechanisms",
    ],
  },
  find(ctx) {
    const out: ReviewCandidate[] = [];
    if (ctx.language === "tsx" || ctx.language === "jsx") {
      findJsxHandlers(ctx.ast as TsxModule, ctx.filePath, out);
    }
    findSourceHandlers(ctx, out);
    return out;
  },
});

function findJsxHandlers(module: TsxModule, filePath: string, out: ReviewCandidate[]): void {
  for (const el of walkJsxElements(module)) {
    for (const attr of el.attributes) {
      if (!GESTURE_HANDLERS.has(attr.name)) continue;
      for (const criterionId of CRITERION_IDS) {
        out.push({
          criterionId,
          location: { filePath, line: attr.loc.start.line, column: attr.loc.start.column },
          reason: `<${el.tagName}> has ${attr.name}${GESTURE_REASON}`,
        });
      }
    }
  }
}

function findSourceHandlers(ctx: RuleContext, out: ReviewCandidate[]): void {
  const seen = new Set<number>();
  for (const { pattern, label } of SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of ctx.source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      if (seen.has(offset)) continue;
      seen.add(offset);
      const { line, column } = offsetToLineColumn(ctx.source, offset);
      const token = match[1] ?? "";
      const rendered = label.replace("$1", token);
      for (const criterionId of CRITERION_IDS) {
        out.push({
          criterionId,
          location: { filePath: ctx.filePath, line, column },
          reason: `${rendered}${GESTURE_REASON}`,
        });
      }
    }
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
