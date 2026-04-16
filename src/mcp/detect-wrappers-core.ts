/**
 * Shared wrapper-detection core, used by:
 *   - the `detect_native_wrappers` MCP tool (explicit onboarding pass)
 *   - the `autoDetectWrappers` flag on `scan_project` (inline, so the
 *     first-run scan has meaningful coverage without an onboarding
 *     round-trip)
 *
 * Two structural signals, each overwhelmingly indicative that the
 * component wraps a native interactive element:
 *   - button/link wrapper: PascalCase tag with an `onClick` prop
 *   - input wrapper: PascalCase tag with `onChange` AND one of
 *     `value`/`defaultValue`/`checked` (the controlled/uncontrolled
 *     React form-input signal)
 *
 * False positives on these heuristics are bounded — a PascalCase
 * onClick that wraps a <div> is a real bug whether the scanner flags
 * it or not. Including it in nativeWrappers for one scan only hides it
 * from the "opaqueCustomComponents" count; it does not suppress any
 * violation.
 */

import { hasJsxAttribute, walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import type { JsxElement, TsxModule } from "../types/ast.ts";

/** Max example call sites per component in the structured result. */
const SAMPLE_LIMIT = 3;

export interface WrapperCandidate {
  readonly component: string;
  readonly occurrences: number;
  readonly sampleLocations: readonly { readonly path: string; readonly line: number }[];
}

/**
 * Walk every parsed JSX/TSX file, group PascalCase elements that look
 * like native-interactive wrappers (button-shaped or input-shaped) by
 * component name. Sorted by occurrences desc, then name asc so the
 * order is deterministic across runs.
 */
export function collectWrapperCandidates(
  files: readonly ParsedFile[],
): readonly WrapperCandidate[] {
  const groups = new Map<string, { count: number; locations: { path: string; line: number }[] }>();
  for (const file of files) {
    if (file.ast.language !== "tsx") continue;
    const tsx = file.ast.root as TsxModule;
    for (const el of walkJsxElements(tsx)) {
      if (!isPascalCase(el.tagName)) continue;
      if (!looksLikeWrapper(el)) continue;
      const entry = groups.get(el.tagName) ?? { count: 0, locations: [] };
      entry.count += 1;
      if (entry.locations.length < SAMPLE_LIMIT) {
        entry.locations.push({ path: file.filePath, line: el.loc.start.line });
      }
      groups.set(el.tagName, entry);
    }
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .map(([component, { count, locations }]) => ({
      component,
      occurrences: count,
      sampleLocations: locations,
    }));
}

/**
 * True if the element carries prop shapes that indicate it wraps a
 * native interactive element. Button-shaped and input-shaped both
 * qualify; a single element need only match one.
 */
function looksLikeWrapper(el: JsxElement): boolean {
  if (hasJsxAttribute(el, "onClick")) return true;
  if (!hasJsxAttribute(el, "onChange")) return false;
  return (
    hasJsxAttribute(el, "value") ||
    hasJsxAttribute(el, "defaultValue") ||
    hasJsxAttribute(el, "checked")
  );
}

function isPascalCase(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= "A" && first <= "Z";
}
