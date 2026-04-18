/**
 * Candidate finder: review/flashing-content
 * Criteria: wcag22:2.3.1, wcag21:2.3.1 (Three Flashes or Below Threshold, A)
 * Spec: https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold
 *
 * 2.3.1 forbids content that flashes >3 times per second unless the
 * flash and red-flash areas are below physical thresholds. A static
 * scanner can't measure flash rate or area — it points the reviewer at
 * the concrete high-motion surfaces and lets them verify.
 *
 * Four signal classes: (1) `<video autoplay>` in HTML/JSX; (2)
 * requestAnimationFrame call sites in JS/TS (reason notes whether a
 * matchMedia prefers-reduced-motion check appears in the same file as
 * additive context); (3) CSS animations whose full cycle is ≤333ms
 * (>3Hz) mutating opacity/transform/colour and NOT inside a
 * `@media (prefers-reduced-motion)` block; (4) legacy `<marquee>` /
 * `<blink>`. Per CLAUDE.md §1 and ai-first-consumer.md, the 333ms is
 * an INCLUSION threshold — everything at or below surfaces; the agent
 * decides from the observed duration quoted in the reason text.
 *
 * CSS helpers live in flashing-content-css.ts.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  hasHtmlAttribute,
} from "../../engine/ast-helpers.ts";
import type {
  CssStylesheet,
  HtmlDocument,
  HtmlElement,
  JsxElement,
  TsxModule,
} from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { RuleContext } from "../../types/rule.ts";
import { findCssCandidates } from "./flashing-content-css.ts";

const CRITERION_IDS = ["wcag22:2.3.1", "wcag21:2.3.1"] as const;

const RAF_PATTERN = /\brequestAnimationFrame\s*\(/g;
const REDUCED_MOTION_MATCHMEDIA =
  /matchMedia\s*\(\s*['"`][^'"`]*prefers-reduced-motion[^'"`]*['"`]\s*\)/;

const VIDEO_REASON =
  " — autoplay video may present flashing or rapidly changing content; verify no region flashes more than 3 times per second (or that flashing area stays below the WCAG 2.3.1 general-flash and red-flash thresholds)";

const MARQUEE_BLINK_REASON_PREFIX =
  "<$TAG> — legacy element that moves/blinks continuously with no user control";
const MARQUEE_BLINK_REASON_SUFFIX =
  "; verify the motion does not flash more than 3 times per second over a large area and that a mechanism to stop it exists";

const RAF_REASON_BASE =
  "requestAnimationFrame() call — animation loop paints every frame; verify any colour/opacity/luminance cycles stay below 3 flashes per second over the WCAG 2.3.1 flash-area thresholds";
const RAF_REDUCED_MOTION_NOTE =
  " (a matchMedia('prefers-reduced-motion: reduce') check appears in this file — confirm the animation loop actually honours it)";
const RAF_NO_REDUCED_MOTION_NOTE =
  " (no matchMedia('prefers-reduced-motion: reduce') check seen in this file)";

export const finder = defineCandidateFinder({
  id: "review/flashing-content",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js", ".css"] },
  docs: {
    description:
      "Finds static signals of flashing or high-motion content: <video autoplay>, requestAnimationFrame loops, short-cycle CSS @keyframes mutating opacity/transform without a prefers-reduced-motion guard, and legacy <marquee>/<blink> tags.",
    reviewPrompt:
      "At each candidate, verify whether the content flashes more than three times per second over a region large enough to exceed the WCAG 2.3.1 general-flash or red-flash thresholds. Physical thresholds: general flash >3/s over >25% of 10° of the visual field; red flash >3/s with a saturated-red component. Static analysis cannot measure either — the reviewer reads the file and, if needed, loads the page.",
    references: [
      "https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold",
      "https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html",
    ],
  },
  find(ctx) {
    const out: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, out);
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, out);
      findRafCandidates(ctx, out);
    } else if (ctx.language === "css") {
      findCssCandidates(
        ctx.ast as CssStylesheet,
        (line, column, reason) => {
          emitCandidates(out, ctx.filePath, line, column, reason, "medium");
        },
        out,
      );
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function findHtmlCandidates(doc: HtmlDocument, filePath: string, out: ReviewCandidate[]): void {
  for (const el of findHtmlElementsByTag(doc, "video")) {
    if (!hasHtmlAttribute(el, "autoplay")) continue;
    emitCandidates(
      out,
      filePath,
      el.loc.start.line,
      el.loc.start.column,
      `<video autoplay>${VIDEO_REASON}`,
      "medium",
    );
  }
  for (const tag of ["marquee", "blink"] as const) {
    for (const el of findHtmlElementsByTag(doc, tag)) {
      emitLegacyTag(out, filePath, el, tag);
    }
  }
}

function emitLegacyTag(
  out: ReviewCandidate[],
  filePath: string,
  el: HtmlElement,
  tag: string,
): void {
  const reason = `${MARQUEE_BLINK_REASON_PREFIX.replace("$TAG", tag)}${MARQUEE_BLINK_REASON_SUFFIX}`;
  emitCandidates(out, filePath, el.loc.start.line, el.loc.start.column, reason, "high");
}

// ---------------------------------------------------------------------------
// JSX / TS / JS
// ---------------------------------------------------------------------------

function findJsxCandidates(module: TsxModule, filePath: string, out: ReviewCandidate[]): void {
  for (const el of findJsxElementsByTag(module, "video")) {
    if (!hasTruthyAutoplay(el)) continue;
    emitCandidates(
      out,
      filePath,
      el.loc.start.line,
      el.loc.start.column,
      `<video autoplay>${VIDEO_REASON}`,
      "medium",
    );
  }
  for (const tag of ["marquee", "blink"] as const) {
    for (const el of findJsxElementsByTag(module, tag)) {
      emitJsxLegacyTag(out, filePath, el, tag);
    }
  }
}

function emitJsxLegacyTag(
  out: ReviewCandidate[],
  filePath: string,
  el: JsxElement,
  tag: string,
): void {
  const reason = `${MARQUEE_BLINK_REASON_PREFIX.replace("$TAG", tag)}${MARQUEE_BLINK_REASON_SUFFIX}`;
  emitCandidates(out, filePath, el.loc.start.line, el.loc.start.column, reason, "high");
}

function hasTruthyAutoplay(el: JsxElement): boolean {
  for (const attr of el.attributes) {
    if (attr.name !== "autoplay" && attr.name !== "autoPlay") continue;
    const value = attr.value;
    if (value === null) return true;
    if (value.kind === "StringLiteral") return true;
    const raw = value.raw.replace(/\s+/g, "");
    if (raw === "{false}" || raw === "{null}" || raw === "{undefined}") return false;
    return true;
  }
  return false;
}

function findRafCandidates(ctx: RuleContext, out: ReviewCandidate[]): void {
  RAF_PATTERN.lastIndex = 0;
  const hasReducedMotionCheck = REDUCED_MOTION_MATCHMEDIA.test(ctx.source);
  const note = hasReducedMotionCheck ? RAF_REDUCED_MOTION_NOTE : RAF_NO_REDUCED_MOTION_NOTE;
  const reason = `${RAF_REASON_BASE}${note}`;
  const seen = new Set<number>();
  for (const match of ctx.source.matchAll(RAF_PATTERN)) {
    const offset = match.index ?? 0;
    if (seen.has(offset)) continue;
    seen.add(offset);
    const { line, column } = offsetToLineColumn(ctx.source, offset);
    emitCandidates(out, ctx.filePath, line, column, reason, "medium");
  }
}

// ---------------------------------------------------------------------------
// Shared emission / source-offset helpers
// ---------------------------------------------------------------------------

function emitCandidates(
  out: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  reason: string,
  confidence: "high" | "medium" | "low",
): void {
  for (const criterionId of CRITERION_IDS) {
    out.push({
      criterionId,
      location: { filePath, line, column },
      reason,
      confidence,
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
