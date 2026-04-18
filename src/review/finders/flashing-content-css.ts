/**
 * CSS detection helpers for the review/flashing-content finder.
 *
 * Split out of flashing-content.ts to keep each module under the
 * 400-line review cap. The entry point is findCssCandidates; the rest
 * are animation-shorthand and @keyframes helpers the finder needs.
 * See the top-of-file docblock in flashing-content.ts for why the
 * ≤333ms threshold is an inclusion signal, not a suppression gate.
 */

import { walkCssAtRules, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssAtRule, CssRule, CssStylesheet } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const SHORT_CYCLE_MS = 333;

const FLASH_PROPERTIES: ReadonlySet<string> = new Set([
  "opacity",
  "transform",
  "background",
  "background-color",
  "color",
  "filter",
  "visibility",
]);

const ANIMATION_RESERVED: ReadonlySet<string> = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "none",
  "running",
  "paused",
  "infinite",
  "initial",
  "inherit",
  "unset",
  "revert",
]);

interface FlashInfo {
  readonly declarationLine: number;
  readonly declarationColumn: number;
  readonly reason: string;
}

interface ParsedAnimation {
  readonly durationMs: number;
  readonly name: string | undefined;
}

interface KeyframesSummary {
  readonly mutatesFlashProperties: boolean;
  readonly observedProperties: readonly string[];
}

export type CssEmit = (line: number, column: number, reason: string) => void;

export function findCssCandidates(
  stylesheet: CssStylesheet,
  emit: CssEmit,
  _out: ReviewCandidate[],
): void {
  const guardedRules = collectReducedMotionGuardedRules(stylesheet);
  const keyframesIndex = indexKeyframes(stylesheet);

  for (const cssRule of walkCssRules(stylesheet)) {
    if (guardedRules.has(cssRule)) continue;
    const flashInfo = extractShortCycleFlashInfo(cssRule, keyframesIndex);
    if (!flashInfo) continue;
    emit(flashInfo.declarationLine, flashInfo.declarationColumn, flashInfo.reason);
  }
}

function extractShortCycleFlashInfo(
  cssRule: CssRule,
  keyframesIndex: ReadonlyMap<string, KeyframesSummary>,
): FlashInfo | undefined {
  for (const decl of cssRule.declarations) {
    const prop = decl.property.toLowerCase();
    const parsed = parseAnimationDeclaration(prop, decl.value);
    if (!parsed) continue;
    const { durationMs, name } = parsed;
    if (durationMs > SHORT_CYCLE_MS) continue;
    const summary = name ? keyframesIndex.get(name) : undefined;
    if (summary && !summary.mutatesFlashProperties) continue;
    const reason = buildCssFlashReason(cssRule.selector, durationMs, name, summary);
    return {
      declarationLine: decl.loc.start.line,
      declarationColumn: decl.loc.start.column,
      reason,
    };
  }
  return undefined;
}

function parseAnimationDeclaration(property: string, value: string): ParsedAnimation | undefined {
  const cleaned = value.replace(/!important$/i, "").trim();
  if (property === "animation-duration") {
    const durationMs = parseFirstDurationMs(cleaned);
    return durationMs === undefined ? undefined : { durationMs, name: undefined };
  }
  if (property === "animation") {
    const durationMs = parseFirstDurationMs(cleaned);
    if (durationMs === undefined) return undefined;
    const name = extractAnimationName(cleaned);
    return { durationMs, name };
  }
  return undefined;
}

function parseFirstDurationMs(value: string): number | undefined {
  const match = /(-?\d*\.?\d+)(ms|s)\b/i.exec(value);
  if (!match) return undefined;
  const n = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(n)) return undefined;
  const unit = (match[2] ?? "").toLowerCase();
  return unit === "s" ? n * 1000 : n;
}

function extractAnimationName(value: string): string | undefined {
  const withoutFns = value.replace(/\b(?:cubic-bezier|steps)\s*\([^)]*\)/gi, "");
  const tokens = withoutFns.split(/\s+/).filter((t) => t.length > 0);
  let candidate: string | undefined;
  for (const token of tokens) {
    if (/^(-?\d*\.?\d+)(ms|s)?$/i.test(token)) continue;
    const lowered = token.toLowerCase();
    if (ANIMATION_RESERVED.has(lowered)) continue;
    if (/^[a-z_][\w-]*$/i.test(token)) candidate = token;
  }
  return candidate;
}

function indexKeyframes(stylesheet: CssStylesheet): ReadonlyMap<string, KeyframesSummary> {
  const index = new Map<string, KeyframesSummary>();
  for (const atRule of walkCssAtRules(stylesheet)) {
    const name = atRule.name.toLowerCase();
    if (name !== "keyframes" && name !== "-webkit-keyframes") continue;
    const animationName = atRule.params.trim();
    if (!animationName) continue;
    index.set(animationName, summariseKeyframes(atRule));
  }
  return index;
}

function summariseKeyframes(atRule: CssAtRule): KeyframesSummary {
  const props = new Set<string>();
  for (const child of atRule.children) {
    if (child.kind !== "CssRule") continue;
    for (const decl of child.declarations) {
      props.add(decl.property.toLowerCase());
    }
  }
  let mutates = false;
  for (const p of props) {
    if (FLASH_PROPERTIES.has(p)) {
      mutates = true;
      break;
    }
  }
  return {
    mutatesFlashProperties: mutates,
    observedProperties: [...props].sort(),
  };
}

function buildCssFlashReason(
  selector: string,
  durationMs: number,
  name: string | undefined,
  summary: KeyframesSummary | undefined,
): string {
  const durationText = formatDuration(durationMs);
  const frequency = durationMs > 0 ? (1000 / durationMs).toFixed(1) : "∞";
  const target = name ? `animation '${name}'` : "animation";
  const propsNote =
    summary && summary.observedProperties.length > 0
      ? ` mutating ${summary.observedProperties.join(", ")}`
      : "";
  return `'${selector}' ${target}${propsNote} runs one cycle every ${durationText} (~${frequency} cycles/s) with no prefers-reduced-motion guard — verify the animation does not flash more than 3 times per second over an area larger than the WCAG 2.3.1 general-flash threshold`;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function collectReducedMotionGuardedRules(stylesheet: CssStylesheet): ReadonlySet<CssRule> {
  const guarded = new Set<CssRule>();
  for (const atRule of walkCssAtRules(stylesheet)) {
    if (!isReducedMotionQuery(atRule)) continue;
    for (const child of walkAtRuleChildren(atRule)) {
      guarded.add(child);
    }
  }
  return guarded;
}

function isReducedMotionQuery(atRule: CssAtRule): boolean {
  if (atRule.name.toLowerCase() !== "media") return false;
  return /prefers-reduced-motion/i.test(atRule.params);
}

function* walkAtRuleChildren(atRule: CssAtRule): Iterable<CssRule> {
  for (const child of atRule.children) {
    if (child.kind === "CssRule") {
      yield child;
    } else if (child.kind === "CssAtRule") {
      yield* walkAtRuleChildren(child);
    }
  }
}
