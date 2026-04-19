/**
 * Shared primitives for resolving a PascalCase component name to its
 * defining file and inspecting the first JSX element that file renders.
 *
 * These are the building blocks behind two independent consumers:
 *   - The MCP `detect_native_wrappers` tool / `autoDetectWrappers` flag
 *     (in `src/mcp/detect-wrappers-core.ts`), which uses them to decide
 *     which auto-discovered wrapper candidates are *structurally
 *     confirmed* native-interactive roots.
 *   - The `wrapper/drift` rule (`src/rules/wrapper/drift.ts`), which
 *     uses them to verify each declaration in
 *     `LoadedConfig.nativeWrapperElements` still matches reality.
 *
 * Both probes follow the same one-hop, deliberately-narrow heuristic:
 * match `ComponentName.{tsx,jsx,ts,js}` by basename in the parsed-file
 * set; no import resolution, no transitive re-export following. When
 * the definition isn't in scan scope we return `undefined` rather than
 * guessing — the agent (or the rule, by emitting nothing) is the
 * correct arbiter of what that means.
 */

import type { Language } from "../types/rule.ts";

/** Extensions the probe recognises as potential component source files. */
const CANDIDATE_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".tsx", ".jsx", ".ts", ".js"]);

/** Source languages the probe can crack open to read the JSX root. */
const SOURCE_LANGUAGES: ReadonlySet<Language> = new Set<Language>(["tsx", "jsx", "ts", "js"]);

/**
 * The minimal shape the probe needs. Both `ParsedFile` (MCP side) and
 * `ProjectRuleFile` (rule side) satisfy it after a trivial adapter —
 * `ParsedFile.ast` is `{ language, root }` while `ProjectRuleFile`
 * already exposes `{ filePath, language, ast }` (where `ast` is the
 * root node). Each caller maps its own file shape onto this one.
 */
export interface ProbeFile {
  readonly filePath: string;
  readonly language: Language;
  /** The parser's root node for this file. Treated opaquely until we
   * need the first JSX element. */
  readonly root: unknown;
}

/**
 * Extracts the component name from a file path by taking the basename
 * and stripping the extension. Returns null when the extension isn't
 * one of the supported source kinds, the basename doesn't start with
 * an uppercase letter (PascalCase convention), or the stem is empty.
 * Accepts both `/` and `\` path separators so Windows paths work.
 */
export function componentNameFromPath(filePath: string): string | null {
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
 * Builds a `ComponentName → ProbeFile` index by basename match. Only
 * TSX/JSX/TS/JS files qualify; only PascalCase basenames are recorded.
 * When two files share a basename (rare — e.g. two components both named
 * `Button` under different roots), the first seen wins. The probe is a
 * best-effort structural check, not a module resolver.
 */
export function indexFilesByComponentName<T extends ProbeFile>(
  files: readonly T[],
): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  for (const file of files) {
    if (!SOURCE_LANGUAGES.has(file.language)) continue;
    const name = componentNameFromPath(file.filePath);
    if (name === null) continue;
    if (!out.has(name)) out.set(name, file);
  }
  return out;
}

/**
 * Returns the lowercased tag name of the first top-level JSX element
 * the file contains, or `null` when the file has no JSX (bare TS/JS,
 * fragment-rooted render, or an unrecognised root shape). The caller
 * compares against the expected element or the confirmed-native set.
 *
 * The probe reads only the first element because "the component's
 * root" is what call-site a11y checks see. Helpers defined earlier in
 * the file can shift this — same caveat the `detect_native_wrappers`
 * classifier carries. If refinement is ever needed, it lives here
 * (one place) rather than in each consumer.
 */
export function firstJsxRootTag(file: ProbeFile | undefined): string | null {
  if (!file) return null;
  if (!SOURCE_LANGUAGES.has(file.language)) return null;
  const root = file.root as { readonly jsxElements?: readonly { readonly tagName: string }[] };
  const first = root?.jsxElements?.[0];
  if (!first) return null;
  return first.tagName.toLowerCase();
}
