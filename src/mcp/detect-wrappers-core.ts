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

/** Extensions the probe recognises as potential component source files. */
const CANDIDATE_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".tsx", ".jsx", ".ts", ".js"]);

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
  const filesByComponent = indexFilesByComponentName(files);
  const confirmed: string[] = [];
  const assumed: string[] = [];
  for (const name of candidates) {
    if (isRootNativeInteractive(filesByComponent.get(name))) {
      confirmed.push(name);
    } else {
      assumed.push(name);
    }
  }
  confirmed.sort();
  assumed.sort();
  return { confirmed, assumed };
}

/**
 * Builds a `ComponentName → ParsedFile` index by basename match.
 * Only TSX/JSX/TS/JS files qualify; only PascalCase basenames are
 * recorded. When two files share a basename (rare: e.g., two
 * components both named `Button` under different roots), the first
 * seen wins — the probe is a best-effort structural check, not a
 * module resolver.
 */
function indexFilesByComponentName(files: readonly ParsedFile[]): ReadonlyMap<string, ParsedFile> {
  const out = new Map<string, ParsedFile>();
  for (const file of files) {
    if (file.ast.language !== "tsx" && file.ast.language !== "jsx") {
      if (file.ast.language !== "ts" && file.ast.language !== "js") continue;
    }
    const name = componentNameFromPath(file.filePath);
    if (name === null) continue;
    if (!out.has(name)) out.set(name, file);
  }
  return out;
}

/**
 * Extracts the component name from a file path by taking the basename
 * and stripping the extension. Returns null when the extension isn't
 * one of the supported source kinds, the basename doesn't start with
 * an uppercase letter (PascalCase convention), or the stem is empty.
 * Accepts both `/` and `\` path separators so Windows paths work.
 */
function componentNameFromPath(filePath: string): string | null {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const basename = lastSep === -1 ? filePath : filePath.slice(lastSep + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return null;
  const stem = basename.slice(0, dot);
  const ext = basename.slice(dot).toLowerCase();
  if (!CANDIDATE_SOURCE_EXTENSIONS.has(ext)) return null;
  const first = stem[0];
  if (first === undefined || first < "A" || first > "Z") return null;
  return stem;
}

/**
 * True when the first top-level JSX element in the module has a
 * native-interactive tag. Fragments, `ts`/`js` files without JSX, and
 * the "no JSX at all" case all resolve to false — only a direct hit
 * on a native tag earns `confirmed`.
 */
function isRootNativeInteractive(file: ParsedFile | undefined): boolean {
  if (!file) return false;
  if (
    file.ast.language !== "tsx" &&
    file.ast.language !== "jsx" &&
    file.ast.language !== "ts" &&
    file.ast.language !== "js"
  ) {
    return false;
  }
  const root = file.ast.root as TsxModule;
  const first = root.jsxElements[0];
  if (!first) return false;
  return CONFIRMED_NATIVE_ROOT_TAGS.has(first.tagName.toLowerCase());
}
