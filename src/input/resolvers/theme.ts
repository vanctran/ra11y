/**
 * Tailwind theme resolver — maps a parsed `TailwindToken` to a concrete
 * CSS declaration (`property`, `value`) that downstream a11y rules
 * (contrast, reflow, target-size, focus-visibility) can reason about
 * without running Tailwind at build time.
 *
 * Ships with Tailwind's **default theme** inlined; no `tailwindcss`
 * dependency, no config file read. Canonical source for the default
 * theme values: https://tailwindcss.com/docs/theme and the published
 * `tailwindcss/stubs/defaultConfig.stub` — transcribed in
 * `default-theme.ts` to preserve the zero-dep invariant.
 *
 * Scope is deliberately narrow: only utilities that affect automated
 * WCAG checks (sizing, color, spacing, typography, borders, opacity).
 * Unknown utilities return `null`; rules must handle the "unknown"
 * case rather than assuming resolution succeeded.
 *
 * TODO(phase-future): honour a user-supplied `tailwind.config.js` /
 * `tailwind.config.ts` via a separate loader that feeds a custom
 * theme into this resolver. For now, the default theme is the whole
 * world.
 */

import { parseTailwind, type TailwindToken } from "../parsers/tailwind.ts";
import {
  BASE_COLORS,
  BORDER_RADIUS,
  BORDER_WIDTH,
  FONT_SIZE,
  LINE_HEIGHT,
  OPACITY,
  PALETTE,
  SIZE_KEYWORDS,
  SPACING,
} from "./default-theme.ts";

/** A resolved CSS declaration. `value` is always a string for uniformity. */
export interface ResolvedDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * Resolve a single Tailwind token to one or more concrete CSS
 * declarations. Most utilities resolve to a single declaration;
 * `text-<size>` additionally emits a paired `line-height`, matching
 * what Tailwind's generated CSS would produce.
 *
 * Returns `null` when the utility is unknown, malformed, or outside
 * the resolver's scope.
 */
export function resolveTailwindToken(token: TailwindToken): ResolvedDeclaration[] | null {
  if (token.malformed) return null;
  const { utility, negative, arbitraryValue, modifier } = token;

  // Dispatch by utility family. The match order matters: longer
  // prefixes are tried before shorter ones (e.g. `min-w-` before `w-`).
  const family = classifyFamily(utility);
  if (family === null) return null;

  switch (family.kind) {
    case "sizing":
      return resolveSizing(family.property, family.suffix, arbitraryValue);
    case "spacing":
      return resolveSpacing(family.property, family.suffix, arbitraryValue, negative);
    case "gap":
      return resolveGap(family.property, family.suffix, arbitraryValue);
    case "text":
      return resolveText(family.suffix, arbitraryValue, modifier);
    case "bg":
      return resolveColor("background-color", family.suffix, arbitraryValue, modifier);
    case "border-color":
      return resolveColor("border-color", family.suffix, arbitraryValue, modifier);
    case "border-width":
      return resolveBorderWidth(family.suffix, arbitraryValue);
    case "rounded":
      return resolveRadius(family.suffix, arbitraryValue);
    case "leading":
      return resolveLineHeight(family.suffix, arbitraryValue);
    case "opacity":
      return resolveOpacity(family.suffix, arbitraryValue);
    default:
      return null;
  }
}

/**
 * Convenience: parse + resolve in one step. Unresolved tokens are
 * skipped — callers that need the raw token list should call
 * `parseTailwind` directly.
 */
export function resolveTailwindClasses(classString: string): ResolvedDeclaration[] {
  const out: ResolvedDeclaration[] = [];
  for (const token of parseTailwind(classString)) {
    const resolved = resolveTailwindToken(token);
    if (resolved !== null) out.push(...resolved);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Family classification
// ─────────────────────────────────────────────────────────────────────────────

type Family =
  | {
      kind: "sizing";
      property: "width" | "height" | "min-width" | "min-height" | "max-width" | "max-height";
      suffix: string;
    }
  | { kind: "spacing"; property: string; suffix: string }
  | { kind: "gap"; property: "gap" | "column-gap" | "row-gap"; suffix: string }
  | { kind: "text"; suffix: string }
  | { kind: "bg"; suffix: string }
  | { kind: "border-color"; suffix: string }
  | { kind: "border-width"; suffix: string }
  | { kind: "rounded"; suffix: string }
  | { kind: "leading"; suffix: string }
  | { kind: "opacity"; suffix: string };

/**
 * Prefix table for simple one-to-one family mappings. Ordered
 * longest-first so that `min-w` wins over `w` via `matchPrefix`.
 */
const SIZING_PREFIXES: ReadonlyArray<[string, SizingProperty]> = [
  ["min-w", "min-width"],
  ["min-h", "min-height"],
  ["max-w", "max-width"],
  ["max-h", "max-height"],
  ["w", "width"],
  ["h", "height"],
];

const SIMPLE_PREFIXES: ReadonlyArray<[string, Family["kind"]]> = [
  ["text", "text"],
  ["bg", "bg"],
  ["rounded", "rounded"],
  ["leading", "leading"],
  ["opacity", "opacity"],
];

/**
 * Map `utility` (the bare portion after variants/important/negative
 * peeling, and after `[value]` extraction) onto a family descriptor.
 * Returns `null` for utilities the resolver does not handle.
 */
function classifyFamily(utility: string): Family | null {
  for (const [head, property] of SIZING_PREFIXES) {
    const suffix = matchPrefix(utility, head);
    if (suffix !== null) return { kind: "sizing", property, suffix };
  }
  const paddingProp = paddingProperty(utility);
  if (paddingProp !== null) {
    return { kind: "spacing", property: paddingProp.property, suffix: paddingProp.suffix };
  }
  const marginProp = marginProperty(utility);
  if (marginProp !== null) {
    return { kind: "spacing", property: marginProp.property, suffix: marginProp.suffix };
  }
  const gap = classifyGap(utility);
  if (gap !== null) return gap;
  const border = classifyBorderFromUtility(utility);
  if (border !== null) return border;
  for (const [head, kind] of SIMPLE_PREFIXES) {
    const suffix = matchPrefix(utility, head);
    if (suffix === null) continue;
    return { kind, suffix } as Family;
  }
  return null;
}

/**
 * Return the suffix (portion after `<head>-`) if `utility` matches the
 * head exactly or as a dash-separated prefix, else `null`.
 */
function matchPrefix(utility: string, head: string): string | null {
  if (utility === head) return "";
  if (utility.startsWith(`${head}-`)) return utility.slice(head.length + 1);
  return null;
}

function classifyGap(utility: string): Family | null {
  const s = matchPrefix(utility, "gap");
  if (s === null) return null;
  if (s === "x") return { kind: "gap", property: "column-gap", suffix: "" };
  if (s.startsWith("x-")) return { kind: "gap", property: "column-gap", suffix: s.slice(2) };
  if (s === "y") return { kind: "gap", property: "row-gap", suffix: "" };
  if (s.startsWith("y-")) return { kind: "gap", property: "row-gap", suffix: s.slice(2) };
  return { kind: "gap", property: "gap", suffix: s };
}

function classifyBorderFromUtility(utility: string): Family | null {
  if (utility !== "border" && !utility.startsWith("border-")) return null;
  return classifyBorder(utility);
}

function suffixOf(utility: string, head: string): string {
  return matchPrefix(utility, head) ?? "";
}

/**
 * `p-2` / `px-4` / `py-1` / `pt-2` etc. Returns property + suffix
 * (the part that resolves via the spacing scale).
 */
function paddingProperty(utility: string): { property: string; suffix: string } | null {
  const map: Record<string, string | string[]> = {
    p: "padding",
    px: ["padding-left", "padding-right"],
    py: ["padding-top", "padding-bottom"],
    ps: "padding-inline-start",
    pe: "padding-inline-end",
    pt: "padding-top",
    pr: "padding-right",
    pb: "padding-bottom",
    pl: "padding-left",
  };
  return axisProperty(utility, map);
}

function marginProperty(utility: string): { property: string; suffix: string } | null {
  const map: Record<string, string | string[]> = {
    m: "margin",
    mx: ["margin-left", "margin-right"],
    my: ["margin-top", "margin-bottom"],
    ms: "margin-inline-start",
    me: "margin-inline-end",
    mt: "margin-top",
    mr: "margin-right",
    mb: "margin-bottom",
    ml: "margin-left",
  };
  return axisProperty(utility, map);
}

/**
 * Walk the map's keys longest-first so that `mx-` matches before
 * `m-`. We flatten the axis-pair case (e.g. `px`) into a
 * space-joined property token and split back out in `resolveSpacing`.
 */
function axisProperty(
  utility: string,
  map: Record<string, string | string[]>,
): { property: string; suffix: string } | null {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (utility === key || utility.startsWith(`${key}-`)) {
      const raw = map[key];
      if (raw === undefined) continue;
      const property = Array.isArray(raw) ? raw.join(" ") : raw;
      return { property, suffix: suffixOf(utility, key) };
    }
  }
  return null;
}

/**
 * Distinguish `border-<width>` / `border-<side>` / `border-<color>`.
 * We recognize color by looking up the suffix in the palette; anything
 * else falls into width/side handling.
 */
function classifyBorder(utility: string): Family | null {
  const suffix = utility === "border" ? "" : suffixOf(utility, "border");
  // Side-specific width: border-t, border-r-2, etc.
  const sideMatch = /^([trblxyse])(?:-(.*))?$/.exec(suffix);
  if (sideMatch !== null && suffix !== "") {
    // These resolve in `resolveBorderWidth` using the full suffix.
    return { kind: "border-width", suffix };
  }
  // Pure width: border, border-2, border-0, border-4, border-8.
  if (suffix === "" || /^\d+$/.test(suffix)) {
    return { kind: "border-width", suffix };
  }
  // Otherwise treat as color.
  return { kind: "border-color", suffix };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-family resolvers
// ─────────────────────────────────────────────────────────────────────────────

type SizingProperty = "width" | "height" | "min-width" | "min-height" | "max-width" | "max-height";

function resolveSizing(
  property: SizingProperty,
  suffix: string,
  arbitrary: string | null,
): ResolvedDeclaration[] | null {
  if (arbitrary !== null) return [{ property, value: normalizeArbitrary(arbitrary) }];
  const value = lookupSize(property, suffix);
  if (value === null) return null;
  return [{ property, value }];
}

/**
 * Size lookup: `SIZE_KEYWORDS` first (handles auto/full/screen/fractions),
 * then the spacing scale. `screen` on height-based properties maps to
 * 100vh rather than the default 100vw.
 */
function lookupSize(property: string, suffix: string): string | null {
  if (property.endsWith("height") && suffix === "screen") return "100vh";
  if (Object.hasOwn(SIZE_KEYWORDS, suffix)) return SIZE_KEYWORDS[suffix] ?? null;
  if (Object.hasOwn(SPACING, suffix)) return SPACING[suffix] ?? null;
  return null;
}

function resolveSpacing(
  property: string,
  suffix: string,
  arbitrary: string | null,
  negative: boolean,
): ResolvedDeclaration[] | null {
  const value = arbitrary === null ? (SPACING[suffix] ?? null) : normalizeArbitrary(arbitrary);
  if (value === null) return null;
  const signed = negative ? negate(value) : value;
  // Multi-axis properties were space-joined in `axisProperty`.
  const properties = property.split(" ");
  return properties.map((p) => ({ property: p, value: signed }));
}

function resolveGap(
  property: string,
  suffix: string,
  arbitrary: string | null,
): ResolvedDeclaration[] | null {
  const value = arbitrary === null ? (SPACING[suffix] ?? null) : normalizeArbitrary(arbitrary);
  if (value === null) return null;
  return [{ property, value }];
}

function resolveText(
  suffix: string,
  arbitrary: string | null,
  modifier: string | null,
): ResolvedDeclaration[] | null {
  // Font size first — `text-lg`, `text-2xl`.
  if (arbitrary === null && Object.hasOwn(FONT_SIZE, suffix)) {
    const entry = FONT_SIZE[suffix];
    if (entry === undefined) return null;
    return [
      { property: "font-size", value: entry.size },
      { property: "line-height", value: entry.lineHeight },
    ];
  }
  // Arbitrary `text-[14px]` — treat as font-size.
  if (arbitrary !== null && /^-?\d/.test(arbitrary)) {
    return [{ property: "font-size", value: normalizeArbitrary(arbitrary) }];
  }
  // Otherwise it's a color: `text-red-500`, `text-[#abc]`.
  return resolveColor("color", suffix, arbitrary, modifier);
}

function resolveBorderWidth(
  suffix: string,
  arbitrary: string | null,
): ResolvedDeclaration[] | null {
  if (arbitrary !== null)
    return [{ property: "border-width", value: normalizeArbitrary(arbitrary) }];
  // Side-specific: border-t, border-t-2, border-x, border-x-4.
  const sideMatch = /^([trblxyse])(?:-(.*))?$/.exec(suffix);
  if (sideMatch !== null) {
    const side = sideMatch[1] as string;
    const width = sideMatch[2] ?? "DEFAULT";
    const value = BORDER_WIDTH[width];
    if (value === undefined) return null;
    return sideProperties("border", side, "width").map((p) => ({ property: p, value }));
  }
  const width = suffix === "" ? "DEFAULT" : suffix;
  const value = BORDER_WIDTH[width];
  if (value === undefined) return null;
  return [{ property: "border-width", value }];
}

function sideProperties(prefix: string, side: string, kind: string): string[] {
  switch (side) {
    case "t":
      return [`${prefix}-top-${kind}`];
    case "r":
      return [`${prefix}-right-${kind}`];
    case "b":
      return [`${prefix}-bottom-${kind}`];
    case "l":
      return [`${prefix}-left-${kind}`];
    case "x":
      return [`${prefix}-left-${kind}`, `${prefix}-right-${kind}`];
    case "y":
      return [`${prefix}-top-${kind}`, `${prefix}-bottom-${kind}`];
    case "s":
      return [`${prefix}-inline-start-${kind}`];
    case "e":
      return [`${prefix}-inline-end-${kind}`];
    default:
      return [`${prefix}-${kind}`];
  }
}

function resolveRadius(suffix: string, arbitrary: string | null): ResolvedDeclaration[] | null {
  if (arbitrary !== null)
    return [{ property: "border-radius", value: normalizeArbitrary(arbitrary) }];
  const key = suffix === "" ? "DEFAULT" : suffix;
  const value = BORDER_RADIUS[key];
  if (value === undefined) return null;
  return [{ property: "border-radius", value }];
}

function resolveLineHeight(suffix: string, arbitrary: string | null): ResolvedDeclaration[] | null {
  if (arbitrary !== null)
    return [{ property: "line-height", value: normalizeArbitrary(arbitrary) }];
  const value = LINE_HEIGHT[suffix];
  if (value === undefined) return null;
  return [{ property: "line-height", value }];
}

function resolveOpacity(suffix: string, arbitrary: string | null): ResolvedDeclaration[] | null {
  if (arbitrary !== null) return [{ property: "opacity", value: normalizeArbitrary(arbitrary) }];
  const value = OPACITY[suffix];
  if (value === undefined) return null;
  return [{ property: "opacity", value }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Color resolution (shared by text/bg/border). Modifier handling added
// in the next slice — this version passes through the raw value.
// ─────────────────────────────────────────────────────────────────────────────

function resolveColor(
  property: string,
  suffix: string,
  arbitrary: string | null,
  modifier: string | null,
): ResolvedDeclaration[] | null {
  const base = arbitrary === null ? lookupColor(suffix) : normalizeArbitrary(arbitrary);
  if (base === null) return null;
  const withAlpha = applyColorModifier(base, modifier);
  if (withAlpha === null) return null;
  return [{ property, value: withAlpha }];
}

function lookupColor(suffix: string): string | null {
  if (Object.hasOwn(BASE_COLORS, suffix)) return BASE_COLORS[suffix] ?? null;
  // Split into family + shade, e.g. `red-500` or `slate-950`.
  const dash = suffix.lastIndexOf("-");
  if (dash === -1) return null;
  const family = suffix.slice(0, dash);
  const shade = suffix.slice(dash + 1);
  const palette = PALETTE[family];
  if (palette === undefined) return null;
  return palette[shade] ?? null;
}

/**
 * Placeholder for the color-modifier pass. Returns the base value
 * unchanged unless a modifier is present — in which case the next
 * slice rewrites this to produce an rgb()/hex-with-alpha form.
 */
function applyColorModifier(base: string, modifier: string | null): string | null {
  if (modifier === null) return base;
  // Temporarily pass through; real implementation in follow-up slice.
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tailwind's arbitrary-value syntax collapses internal spaces into
 * underscores (`bg-[rgb(0_0_0)]`). The resolver emits conventional
 * CSS, so we swap underscores back to spaces — except those preceded
 * by a backslash, which are intentional literal underscores.
 */
function normalizeArbitrary(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch === "\\" && raw.charAt(i + 1) === "_") {
      out += "_";
      i += 1;
      continue;
    }
    out += ch === "_" ? " " : ch;
  }
  return out;
}

function negate(value: string): string {
  if (value.startsWith("-")) return value.slice(1);
  if (value === "0px" || value === "0") return value;
  return `-${value}`;
}
