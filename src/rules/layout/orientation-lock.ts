/**
 * Rule: layout/orientation-lock
 * Satisfies: wcag22:1.3.4, wcag21:1.3.4
 * Spec: https://www.w3.org/TR/WCAG22/#orientation
 *
 * > Content does not restrict its view and operation to a single display
 * > orientation, such as portrait or landscape, unless a specific display
 * > orientation is essential.
 *
 * Source: https://www.w3.org/TR/WCAG22/#orientation
 *
 * Flags CSS `@media` queries that target `orientation: portrait` or
 * `orientation: landscape` when the media query body contains patterns
 * that hide or forcibly rotate content:
 *   - `display: none`
 *   - `visibility: hidden`
 *   - `transform: rotate(90deg)` or `rotate(-90deg)` or `rotate(270deg)`
 *
 * These patterns indicate content is being locked to a single
 * orientation — either by hiding it entirely in one orientation or by
 * forcibly rotating the viewport.
 *
 * Severity: warning — we can't statically distinguish essential
 * orientation locks (e.g., a piano app) from accidental ones.
 *
 * v0.0.x coverage: in-file CSS rules (standalone .css and <style>
 * blocks). Does NOT yet trace Tailwind classes or JS-based locks.
 */

import { defineRule } from "../../api/plugin.ts";
import { walkCssAtRules } from "../../engine/ast-helpers.ts";
import type { CssAtRule, CssNode, CssRule, CssStylesheet } from "../../types/ast.ts";

/** Regex matching orientation media feature in @media params. */
const ORIENTATION_PATTERN = /orientation\s*:\s*(portrait|landscape)/i;

/** Rotation values that indicate a forced orientation flip. */
const LOCK_ROTATIONS: ReadonlySet<string> = new Set([
  "rotate(90deg)",
  "rotate(-90deg)",
  "rotate(270deg)",
]);

export const rule = defineRule({
  id: "layout/orientation-lock",
  satisfies: ["wcag22:1.3.4", "wcag21:1.3.4"],
  severity: "warning",
  scope: "document",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "CSS @media queries targeting orientation must not hide content or force rotation, which locks the page to a single orientation.",
    rationale:
      "Users with mounted devices (wheelchairs, bed mounts) may only be able to view content in one orientation. Locking to portrait or landscape makes the content unusable for them. WCAG requires content to adapt to both orientations unless the orientation is essential to the functionality.",
    goodExample: `@media (orientation: portrait) { .sidebar { flex-direction: column; } }`,
    badExample: `@media (orientation: portrait) { .app { display: none; } }`,
    normativeQuote:
      "Content does not restrict its view and operation to a single display orientation, such as portrait or landscape, unless a specific display orientation is essential.",
    references: [
      "https://www.w3.org/TR/WCAG22/#orientation",
      "https://www.w3.org/WAI/WCAG22/Understanding/orientation.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    const stylesheet = ctx.ast as CssStylesheet;
    for (const atRule of walkCssAtRules(stylesheet)) {
      checkAtRule(atRule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkAtRule(atRule: CssAtRule, emit: Emit): void {
  if (atRule.name.toLowerCase() !== "media") return;
  const orientationMatch = ORIENTATION_PATTERN.exec(atRule.params);
  if (!orientationMatch) return;

  const orientation = orientationMatch[1]?.toLowerCase() ?? "unknown";
  const lockPattern = findLockPattern(atRule.children);
  if (!lockPattern) return;

  emit({
    severity: "warning",
    location: {
      filePath: "",
      line: atRule.loc.start.line,
      column: atRule.loc.start.column,
    },
    message: buildMessage(orientation, lockPattern),
    suggestion: buildSuggestion(orientation, lockPattern),
  });
}

/** Lock pattern descriptor for messaging. */
interface LockPattern {
  readonly type: "hidden" | "rotated";
  readonly selector: string;
  readonly declaration: string;
}

/**
 * Searches children of an orientation @media block for declarations
 * that indicate content is being hidden or forcibly rotated.
 */
function findLockPattern(children: readonly CssNode[]): LockPattern | null {
  for (const child of children) {
    if (child.kind !== "CssRule") continue;
    const found = checkRuleForLock(child);
    if (found) return found;
  }
  return null;
}

function checkRuleForLock(cssRule: CssRule): LockPattern | null {
  for (const decl of cssRule.declarations) {
    const prop = decl.property.toLowerCase();
    const val = decl.value.trim().toLowerCase();

    if (prop === "display" && val === "none") {
      return { type: "hidden", selector: cssRule.selector, declaration: "display: none" };
    }
    if (prop === "visibility" && val === "hidden") {
      return { type: "hidden", selector: cssRule.selector, declaration: "visibility: hidden" };
    }
    if (prop === "transform" && containsLockRotation(val)) {
      return {
        type: "rotated",
        selector: cssRule.selector,
        declaration: `transform: ${decl.value.trim()}`,
      };
    }
  }
  return null;
}

function containsLockRotation(transformValue: string): boolean {
  for (const rotation of LOCK_ROTATIONS) {
    if (transformValue.includes(rotation)) return true;
  }
  return false;
}

function buildMessage(orientation: string, lock: LockPattern): string {
  if (lock.type === "hidden") {
    return `@media (orientation: ${orientation}) hides '${lock.selector}' with \`${lock.declaration}\` — this locks content to a single orientation.`;
  }
  return `@media (orientation: ${orientation}) forcibly rotates '${lock.selector}' with \`${lock.declaration}\` — this locks the viewport to a single orientation.`;
}

function buildSuggestion(orientation: string, lock: LockPattern): string {
  if (lock.type === "hidden") {
    return `Instead of hiding '${lock.selector}' in ${orientation} mode, adapt the layout (e.g., change flex-direction or grid columns). Content must remain usable in both orientations unless the orientation is essential to the functionality.`;
  }
  return `Instead of rotating '${lock.selector}' in ${orientation} mode, adapt the layout to work naturally in both orientations. Forced rotation disorients users and breaks assistive technology coordinate mapping.`;
}
