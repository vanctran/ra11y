/**
 * Internal helpers for `pointer/target-size`. Extracted to keep the
 * rule file under the per-file line budget. Not a public API — keep
 * the surface narrow.
 */

/** WCAG 2.2 SC 2.5.8 minimum target size in CSS pixels. */
export const MIN_TARGET_PX = 24;

/** 1rem assumption — Tailwind's default base font size, matches browsers. */
const REM_TO_PX = 16;

/**
 * Parse a CSS length to pixels. Returns null when the value is not a
 * static, resolvable length (calc, var, %, vw/vh, auto, …) — those are
 * out of scope for the heuristic.
 */
export function parsePx(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "" || trimmed === "auto") return null;
  if (trimmed === "0") return 0;
  if (trimmed.includes("calc(") || trimmed.includes("var(") || trimmed.includes("min(")) {
    return null;
  }
  const m = /^([+-]?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm)?$/.exec(trimmed);
  if (!m) return null;
  const n = Number.parseFloat(m[1] ?? "");
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? "px";
  return convertToPx(n, unit);
}

function convertToPx(n: number, unit: string): number | null {
  switch (unit) {
    case "px":
      return n;
    case "rem":
    case "em":
      return n * REM_TO_PX;
    case "pt":
      return (n * 4) / 3;
    case "pc":
      return n * 16;
    case "in":
      return n * 96;
    case "cm":
      return (n * 96) / 2.54;
    case "mm":
      return (n * 96) / 25.4;
    default:
      return null;
  }
}

const HORIZONTAL_PADDING_PROPS: ReadonlySet<string> = new Set([
  "padding-left",
  "padding-right",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
]);
const VERTICAL_PADDING_PROPS: ReadonlySet<string> = new Set([
  "padding-top",
  "padding-bottom",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
]);

export function paddingFromDecl(prop: string, value: string): { h: number; v: number } | null {
  if (prop === "padding") {
    const parsed = parsePaddingShorthand(value);
    return parsed === null ? null : { h: parsed.horizontal, v: parsed.vertical };
  }
  if (HORIZONTAL_PADDING_PROPS.has(prop)) {
    const px = parsePx(value);
    return px === null ? null : { h: px, v: 0 };
  }
  if (VERTICAL_PADDING_PROPS.has(prop)) {
    const px = parsePx(value);
    return px === null ? null : { h: 0, v: px };
  }
  return null;
}

/**
 * Parse `padding` shorthand. We need the per-axis minimum padding
 * (smaller of left/right, smaller of top/bottom). Returns null on
 * un-parseable input.
 */
export function parsePaddingShorthand(
  raw: string,
): { horizontal: number; vertical: number } | null {
  const parts = raw.trim().split(/\s+/).map(parsePx);
  if (parts.some((p) => p === null)) return null;
  const nums = parts as number[];
  if (nums.length === 1) {
    const v = nums[0] ?? 0;
    return { horizontal: v, vertical: v };
  }
  if (nums.length === 2) return { horizontal: nums[1] ?? 0, vertical: nums[0] ?? 0 };
  if (nums.length === 3) {
    return { horizontal: nums[1] ?? 0, vertical: Math.min(nums[0] ?? 0, nums[2] ?? 0) };
  }
  if (nums.length === 4) {
    return {
      horizontal: Math.min(nums[1] ?? 0, nums[3] ?? 0),
      vertical: Math.min(nums[0] ?? 0, nums[2] ?? 0),
    };
  }
  return null;
}

/**
 * Accumulator used by JSX className resolution and HTML inline-style
 * parsing — builds an effective box (size + padding) from a stream of
 * (property, value) pairs.
 */
export interface BoxAccumulator {
  widthPx: number | null;
  heightPx: number | null;
  widthIsExplicit: boolean;
  heightIsExplicit: boolean;
  padH: number;
  padV: number;
}

export function newBox(): BoxAccumulator {
  return {
    widthPx: null,
    heightPx: null,
    widthIsExplicit: false,
    heightIsExplicit: false,
    padH: 0,
    padV: 0,
  };
}

export function applyDeclToBox(box: BoxAccumulator, prop: string, value: string): void {
  const px = parsePx(value);
  if (px !== null && (prop === "width" || prop === "min-width")) {
    applyAxis(box, "width", prop === "width", px);
    return;
  }
  if (px !== null && (prop === "height" || prop === "min-height")) {
    applyAxis(box, "height", prop === "height", px);
    return;
  }
  const padContribution = paddingFromDecl(prop, value);
  if (padContribution !== null) {
    box.padH = Math.max(box.padH, padContribution.h);
    box.padV = Math.max(box.padV, padContribution.v);
  }
}

function applyAxis(
  box: BoxAccumulator,
  axis: "width" | "height",
  explicit: boolean,
  px: number,
): void {
  if (axis === "width") {
    if (box.widthPx === null || (!box.widthIsExplicit && explicit)) {
      box.widthPx = px;
      box.widthIsExplicit = explicit;
    }
    return;
  }
  if (box.heightPx === null || (!box.heightIsExplicit && explicit)) {
    box.heightPx = px;
    box.heightIsExplicit = explicit;
  }
}

export interface BoxResult {
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly paddingHorizontalPx: number;
  readonly paddingVerticalPx: number;
  readonly classes: string;
}

export function finalizeBox(box: BoxAccumulator, source: string): BoxResult | null {
  if (box.widthPx === null && box.heightPx === null) return null;
  const widthEff = box.widthPx === null ? Number.POSITIVE_INFINITY : box.widthPx + box.padH * 2;
  const heightEff = box.heightPx === null ? Number.POSITIVE_INFINITY : box.heightPx + box.padV * 2;
  if (widthEff >= MIN_TARGET_PX && heightEff >= MIN_TARGET_PX) return null;
  return {
    widthPx: box.widthPx,
    heightPx: box.heightPx,
    paddingHorizontalPx: box.padH,
    paddingVerticalPx: box.padV,
    classes: source,
  };
}

export function formatBoxSize(sized: {
  readonly widthPx: number | null;
  readonly heightPx: number | null;
}): string {
  if (sized.widthPx !== null && sized.heightPx !== null) {
    return `${sized.widthPx}×${sized.heightPx} CSS pixel`;
  }
  if (sized.widthPx !== null) return `${sized.widthPx}px wide`;
  return `${sized.heightPx}px tall`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
