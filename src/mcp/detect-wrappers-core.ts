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
 *
 * The {@link classifyWrapperCandidates} function adds a one-hop AST
 * probe for the `autoDetectWrappers: true` path (P1-F). See that
 * function's docstring for the exact heuristic + why it's deliberately
 * narrow.
 */

import { hasJsxAttribute, walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import {
  firstJsxRootTag,
  indexFilesByComponentName as indexProbeFiles,
  type ProbeFile,
} from "../engine/wrapper-probe.ts";
import type { JsxElement, TsxModule } from "../types/ast.ts";

/** Max example call sites per component in the structured result. */
const SAMPLE_LIMIT = 3;

export interface WrapperCandidate {
  readonly component: string;
  readonly occurrences: number;
  readonly sampleLocations: readonly { readonly path: string; readonly line: number }[];
  /**
   * Path of the source file that defines the wrapper component, resolved
   * via the same one-hop basename probe used by `classifyWrapperCandidates`
   * (look up `ComponentName.{tsx,jsx,ts,js}` in the parsed-file set; no
   * import resolution; no transitive following through re-export barrels).
   *
   * The field is present on every candidate so the agent can branch on a
   * single axis ("we know where it's defined" vs "we don't"):
   *   - `string` — the resolved absolute path of the defining file. The
   *     agent can open this directly to verify whether the component
   *     really wraps a native interactive element, without a Glob
   *     round-trip.
   *   - `null` — no file in the parsed set has a matching basename. The
   *     wrapper is imported from outside the scan (node_modules, a
   *     sibling package the agent didn't include in `cwd`), is aliased
   *     through a barrel with a different filename, or is declared
   *     inline in a file whose basename doesn't match the component
   *     name. The agent should fall back to Grep/Read to locate it.
   *
   * Per CLAUDE.md §1 "Ambiguous field shapes are dishonest," the field
   * is never `""` — `null` carries the meaningful "we looked and didn't
   * find it" signal, distinct from omission (which would read as "we
   * didn't compute it").
   */
  readonly definitionFile: string | null;
}

/**
 * Walk every parsed JSX/TSX file, group PascalCase elements that look
 * like native-interactive wrappers (button-shaped or input-shaped) by
 * component name. Sorted by occurrences desc, then name asc so the
 * order is deterministic across runs.
 *
 * Each candidate carries a `definitionFile` pointer resolved by one-hop
 * basename match against the parsed-file set — the same probe
 * `classifyWrapperCandidates` uses. Saves the agent a Glob round-trip
 * when the source is in-tree; `null` when it's out-of-tree or aliased
 * through a barrel.
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
  const definitions = indexProbeFiles(files.map(toProbeFile));
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .map(([component, { count, locations }]) => ({
      component,
      occurrences: count,
      sampleLocations: locations,
      definitionFile: definitions.get(component)?.filePath ?? null,
    }));
}

/** Maps a scanner `ParsedFile` onto the minimal shape the probe needs. */
function toProbeFile(file: ParsedFile): ProbeFile {
  return { filePath: file.filePath, language: file.ast.language, root: file.ast.root };
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

// ---------------------------------------------------------------------------
// One-hop AST probe (P1-F)
// ---------------------------------------------------------------------------

/**
 * Tag names the probe accepts as "structurally confirmed native
 * interactive element." These match the exemption set in
 * `keyboard/handler-missing` (minus `summary`, which is rarely the
 * root of a PascalCase wrapper in practice — keep the probe narrower
 * than the rule's suppression list by design).
 */
const CONFIRMED_NATIVE_ROOT_TAGS: ReadonlySet<string> = new Set([
  "button",
  "a",
  "input",
  "textarea",
  "select",
]);

/**
 * Classification of auto-detected wrapper candidates split by how much
 * evidence the scanner has that each name genuinely wraps a native
 * interactive element.
 *
 *   - `confirmed`: the probe found a source file for this component
 *     and its JSX root is a native interactive element
 *     (`<button>` / `<a>` / `<input>` / `<textarea>` / `<select>`).
 *     Safe to silence findings on.
 *
 *   - `assumed`: the probe could not find the source file, the file's
 *     root is a non-native tag (`<div>`, `<span>`, fragment, custom
 *     component), or the root is otherwise ambiguous. The name is
 *     still surfaced so the agent can see the candidate, but the
 *     scanner does NOT silently treat the component as a native
 *     wrapper.
 *
 * Both lists are sorted alphabetically so the shape is deterministic
 * across runs.
 */
export interface ClassifiedWrapperCandidates {
  readonly confirmed: readonly string[];
  readonly assumed: readonly string[];
}

/**
 * Probes each candidate wrapper's source file to decide whether its
 * JSX root is a structurally-confirmed native interactive element.
 *
 * Heuristic (deliberately narrow — see CLAUDE.md §1 "No heuristic
 * suppression" and "Don't duplicate capability the agent already has"):
 *
 *   1. Locate the component's defining file by basename match on
 *      `ComponentName.{tsx,jsx,ts,js}`. This is one-hop and structural
 *      — no import resolution, no fuzzy matching.
 *   2. Inspect the first top-level JSX element of that module. If its
 *      tag name is one of `button`, `a`, `input`, `textarea`, `select`,
 *      mark the candidate `confirmed`. Otherwise `assumed`.
 *   3. If no file matches, the file's JSX root is a custom component
 *      (we don't follow), or we can't read/parse it, default to
 *      `assumed`. The agent reading the source is the correct arbiter.
 *
 * Names are compared case-sensitively. A component file at
 * `components/Button.tsx` matches the `Button` candidate; a file at
 * `components/button.tsx` (lowercase) does not — name-casing is how
 * React itself disambiguates components from intrinsic elements, so
 * the structural match aligns with that convention.
 */
export function classifyWrapperCandidates(
  files: readonly ParsedFile[],
  candidates: readonly string[],
): ClassifiedWrapperCandidates {
  if (candidates.length === 0) return { confirmed: [], assumed: [] };
  const filesByComponent = indexProbeFiles(files.map(toProbeFile));
  const confirmed: string[] = [];
  const assumed: string[] = [];
  for (const name of candidates) {
    const tag = firstJsxRootTag(filesByComponent.get(name));
    if (tag !== null && CONFIRMED_NATIVE_ROOT_TAGS.has(tag)) {
      confirmed.push(name);
    } else {
      assumed.push(name);
    }
  }
  confirmed.sort();
  assumed.sort();
  return { confirmed, assumed };
}
