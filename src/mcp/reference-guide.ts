/**
 * Top-level prose map extracted out of per-finding fields.
 *
 * Every `suppressPlacement` paragraph used to ride on every violation in
 * the response. For large scans that duplicated the same ~300-char prose
 * N times — pure waste for an agent consumer that only needs to read
 * each variant once. The map below is keyed by file extension and
 * populated only with extensions actually observed in the response, so
 * a TSX-only scan doesn't ship the CSS placement paragraph.
 *
 * Shape matches the `referenceGuide` field on `ScanFormatted`. Kept in
 * its own module so `tools-helpers.ts` can stay under the 500-line file
 * budget and the language mapping is easy to find when adding a new
 * file type (e.g. `.mdx`).
 */

const PLACEMENT_TSX =
  "Place on the line immediately above the opening JSX tag of the flagged element — not inside attributes, and not between adjacent JSX siblings without a wrapping expression. The `{/* … */}` wrapper is valid as a JSX expression or at module scope.";
const PLACEMENT_CSS =
  "Place on the line immediately above the CSS rule whose declarations are flagged.";
const PLACEMENT_HTML =
  "Place on the line immediately above the opening tag of the flagged element.";
const PLACEMENT_DEFAULT = "Place on the line immediately above the flagged statement.";

/**
 * Looks up the placement prose for an extension. Keyed without a leading
 * dot and lowercased — the caller normalizes before passing.
 */
export function suppressPlacementForExt(ext: string): string {
  if (ext === "tsx" || ext === "jsx") return PLACEMENT_TSX;
  if (ext === "css") return PLACEMENT_CSS;
  if (ext === "html" || ext === "htm") return PLACEMENT_HTML;
  return PLACEMENT_DEFAULT;
}

export interface ReferenceGuide {
  readonly suppressPlacement: Readonly<Record<string, string>>;
}

/**
 * Builds `referenceGuide.suppressPlacement` from the extensions present
 * in a scan's file entries. Returns `undefined` when no files carry
 * findings so the caller conditional-spreads the whole block away
 * (honest shape per CLAUDE.md §1 — no `{}` sentinel).
 */
export function buildReferenceGuide(
  files: readonly { readonly path: string; readonly findings: readonly unknown[] }[],
): ReferenceGuide | undefined {
  const exts = new Set<string>();
  for (const f of files) {
    if (f.findings.length === 0) continue;
    const dot = f.path.lastIndexOf(".");
    if (dot === -1) {
      exts.add("default");
      continue;
    }
    const raw = f.path.slice(dot + 1).toLowerCase();
    if (raw === "tsx" || raw === "jsx" || raw === "css" || raw === "html" || raw === "htm") {
      exts.add(raw);
    } else {
      exts.add("default");
    }
  }
  if (exts.size === 0) return undefined;
  const suppressPlacement: Record<string, string> = {};
  for (const ext of [...exts].sort()) {
    suppressPlacement[ext] = suppressPlacementForExt(ext);
  }
  return { suppressPlacement };
}

/**
 * Conditional-spread the top-level `referenceGuide` field — omitted when
 * no findings exist. Lets scan-tool handlers spread unconditionally
 * and keeps their cognitive complexity inside the lint budget.
 */
export function referenceGuideField(formatted: { readonly referenceGuide?: ReferenceGuide }): {
  readonly referenceGuide?: ReferenceGuide;
} {
  if (formatted.referenceGuide === undefined) return {};
  return { referenceGuide: formatted.referenceGuide };
}
