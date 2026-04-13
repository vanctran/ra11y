---
title: "The WCAG contrast formula"
topic: concept
audience: agents, contributors
---

# The WCAG contrast formula

WCAG 1.4.3 (AA) and 1.4.6 (AAA) specify minimum contrast ratios between text and its background. Knowing how the ratio is computed lets you reason about why a specific color pair passed or failed, and why small adjustments can flip the verdict.

## The formula

1. Convert each sRGB channel (0–255) to linear:
   ```
   linear(v) = (v / 255) <= 0.03928
               ? (v / 255) / 12.92
               : ((v / 255 + 0.055) / 1.055) ** 2.4
   ```
2. Compute relative luminance:
   ```
   L = 0.2126 * linear(R) + 0.7152 * linear(G) + 0.0722 * linear(B)
   ```
3. Contrast ratio:
   ```
   ratio = (Lbrighter + 0.05) / (Ldarker + 0.05)
   ```

Ratio is a number in `[1, 21]`. White on white is 1. Black on white is 21.

Implemented in `src/utils/contrast.ts`.

## Thresholds

| Text size | AA (1.4.3) | AAA (1.4.6) |
|-----------|------------|-------------|
| Normal    | 4.5:1      | 7:1         |
| Large     | 3:1        | 4.5:1       |

Non-text contrast (UI components, focus indicators, meaningful icons) has its own criterion:

| Target | AA (1.4.11) |
|--------|-------------|
| UI / non-text | 3:1 |

## "Large text" definition

- ≥ 18pt regular, OR
- ≥ 14pt bold

Bold = `font-weight ≥ 700` or `font-weight: bold`.

Unit conversions the `contrast/_shared.ts` helper applies:
- `pt` → pt (no conversion)
- `px` → pt × (72/96), i.e. 16px = 12pt
- `rem` → (n × 16px) → pt, i.e. 1.125rem = 18px = 13.5pt
- `em` → treated as rem (close enough; a real resolver would walk inheritance)
- `%` → unresolvable without inheritance context

## Why 0.03928?

The 0.03928 cutoff comes from the sRGB spec. At that breakpoint, the piecewise gamma curve switches from a linear region (near-black) to a power-curve (mid-tones and bright). The formula is the sRGB inverse, not a WCAG invention.

## The 0.05 offset

The `+ 0.05` terms flatten the ratio near black. Without them, pure black (L=0) would produce an undefined ratio (infinite). With them, `black vs black = 1.0` and the curve is well-behaved across the full range.

## Things the formula doesn't capture

- **Chromatic contrast.** The formula is luminance-only. A red-on-green pair with matching luminance scores 1.0 even though it's the worst color pair for deuteranope users. WCAG 1.4.3 is explicitly luminance-based; 1.4.11 is too. Chromatic contrast is addressed by 1.4.1 (Use of Color), not 1.4.3.
- **Text layered over images.** The "background" is whatever's underneath the text. When that's an image, no simple ratio applies — you need the worst-case luminance across the image region.
- **Alpha transparency.** `color: rgba(0, 0, 0, 0.5)` on a white background effectively makes the text gray. The formula with alpha is more complex; our implementation composites conservatively (treats partial alpha as if fully opaque, which can under-detect failures).

## Practical heuristics

- Darkening the foreground by 20% typically doubles the ratio when starting near 4.5:1.
- Increasing font-size from 14pt to 18pt drops the threshold from 4.5 to 3:1, letting many marginal pairs pass.
- "Dark mode" doesn't automatically meet contrast — dark gray on black fails as readily as light gray on white.

## See also

- `src/utils/contrast.ts` — the formula implementation.
- `src/rules/contrast/minimum.ts`, `src/rules/contrast/enhanced.ts` — WCAG 1.4.3 and 1.4.6 rules.
- WCAG 1.4.3: https://www.w3.org/TR/WCAG22/#contrast-minimum
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) — interactive color tuner.
