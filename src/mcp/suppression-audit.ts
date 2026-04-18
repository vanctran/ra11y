/**
 * Suppression-audit block for MCP scan responses.
 *
 * Walks each parsed file for `ra11y-disable` pragmas and surfaces them
 * alongside the scan result so agents reviewing a clean scan can see
 * where silence was bought — and whether the suppression carried a
 * reason. Split from `tools-helpers.ts` to keep that file under the
 * 500-effective-line budget; the logic is otherwise unchanged from
 * the pre-extraction version.
 */

import { parseInlineDisablesDetailed } from "../config/inline-disables.ts";
import type { ParsedFile } from "../engine/scanner.ts";

export interface SuppressionAuditEntry {
  readonly path: string;
  readonly line: number;
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly ruleIds: readonly string[];
  readonly reason?: string;
  /** `"ra11y-disable"` for comment pragmas; `"ra11y-intentional"` for the JSDoc tag variant. */
  readonly tag?: "ra11y-disable" | "ra11y-intentional";
}

/**
 * Walks each parsed file's source for `ra11y-disable` pragmas and
 * flattens them into a per-file audit list. The reason-capture path
 * of the pragma parser is used so MCP consumers see both the
 * declaration and the justification (when supplied). Entries without
 * a reason surface as "suppression without a stated reason" — the
 * exact thing an agent reviewing a clean scan should flag for
 * follow-up.
 */
export function suppressionAudit(files: readonly ParsedFile[]): readonly SuppressionAuditEntry[] {
  const out: SuppressionAuditEntry[] = [];
  for (const file of files) {
    const { declarations } = parseInlineDisablesDetailed(file.source);
    for (const d of declarations) {
      out.push({
        path: file.filePath,
        line: d.line,
        kind: d.kind,
        ruleIds: d.ruleIds,
        ...(d.reason === undefined ? {} : { reason: d.reason }),
        ...(d.tag === undefined ? {} : { tag: d.tag }),
      });
    }
  }
  return out;
}

/**
 * Spread-in block for `meta` — empty object when no entries (so clean
 * files don't ship a dangling `suppressions: []`). The `suppressionsNote`
 * prose explains the shape to first-time consumers without inlining a
 * full paragraph into every finding.
 */
export function suppressionsMetaBlock(
  entries: readonly SuppressionAuditEntry[],
): Record<string, unknown> {
  if (entries.length === 0) return {};
  return {
    suppressions: entries,
    suppressionsNote:
      "Each in-source `ra11y-disable` pragma found across scanned files. Reasons captured from the optional `: reason` or `-- reason` suffix on the pragma itself — e.g. `// ra11y-disable-next-line contrast/minimum: light text on brand gradient`. Entries without a reason indicate an un-justified suppression the agent should consider replacing or documenting.",
  };
}
