/**
 * Shared wrapper-detection core, used by:
 *   - the `detect_native_wrappers` MCP tool (explicit onboarding pass)
 *   - the `autoDetectWrappers` flag on `scan_project` (inline, so the
 *     first-run scan has meaningful coverage without an onboarding
 *     round-trip)
 *
 * The heuristic — "PascalCase JSX tag that carries an `onClick` prop"
 * — mirrors the one in the keyboard/handler-missing rule: custom
 * components that receive onClick are overwhelmingly wrappers around a
 * native interactive element (button / a / input / label / etc.), not
 * raw <div onClick> bugs.
 *
 * False positives on this heuristic are bounded — a PascalCase onClick
 * that wraps a <div> is a real bug whether the scanner flags it or
 * not. Including it in nativeWrappers for one scan only hides it from
 * the "opaqueCustomComponents" count; it does not suppress any
 * violation.
 */

import { hasJsxAttribute, walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import type { TsxModule } from "../types/ast.ts";

/** Max example call sites per component in the structured result. */
const SAMPLE_LIMIT = 3;

export interface WrapperCandidate {
  readonly component: string;
  readonly occurrences: number;
  readonly sampleLocations: readonly { readonly path: string; readonly line: number }[];
}

/**
 * Walk every parsed JSX/TSX file, group PascalCase elements with an
 * onClick prop by component name. Sorted by occurrences desc, then
 * name asc so the order is deterministic across runs.
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
      if (!hasJsxAttribute(el, "onClick")) continue;
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

function isPascalCase(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= "A" && first <= "Z";
}
