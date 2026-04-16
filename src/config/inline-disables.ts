/**
 * Inline disable pragma parser.
 *
 * Users suppress individual violations via comments. Supported forms:
 *
 *   // ra11y-disable-next-line contrast/minimum
 *   <div className="muted">  // the next line's violation is skipped
 *
 *   // ra11y-disable contrast/minimum
 *   <div>...</div>
 *   // ra11y-enable contrast/minimum
 *     ^^^ violations between these are skipped
 *
 *   // ra11y-disable-next-line
 *   <div>...</div>
 *     ^^^ wildcard — all rules suppressed on that line
 *
 *   // ra11y-disable-next-line contrast/minimum: light text is only
 *   //   shown on a dark brand gradient that's enforced elsewhere
 *   <div className="muted">
 *     ^^^ reason text after `:` or `--` is captured for audit. Any
 *         rule IDs listed before the separator still apply. The
 *         reason is advisory — the suppression fires whether or
 *         not one is supplied — but surfacing it in scan meta keeps
 *         suppressions accountable.
 *
 * Comment styles supported: `//`, `/* … *\/`, `<!-- … -->` (HTML).
 * JSX `{/* … *\/}` is also recognized.
 *
 * Tokens in the directive are stored opaquely — they can be rule IDs
 * (e.g. `keyboard/handler-missing`) to silence rule violations, or
 * criterion IDs (e.g. `wcag22:2.4.5`) to silence review candidates.
 * The rule-runner matches on rule IDs; the candidate-runner matches on
 * criterion IDs. A bare `ra11y-disable` with no token yields `"*"`,
 * which silences both.
 *
 * `parseInlineDisables(source)` returns the `(line → Set<token>)` map
 * the engine's context-builder consumes via `ctx.isDisabled(line,
 * ruleId)`. `parseInlineDisablesDetailed(source)` returns the same map
 * plus an ordered list of every declaration (line, ruleIds, optional
 * reason) so MCP surfaces can surface a durable audit trail without
 * re-parsing the source.
 */

const COMMENT_PATTERNS: readonly RegExp[] = [
  // Line comment: // ra11y-…
  /\/\/\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*(.*)$/,
  // Block comment: /* ra11y-… */
  /\/\*\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*([^*]*)\*\//,
  // HTML comment: <!-- ra11y-… -->
  /<!--\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*(.*?)-->/,
  // JSX block comment: {/* ra11y-… */}
  /\{\s*\/\*\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*([^*]*)\*\/\s*\}/,
];

export type DisableMap = Map<number, Set<string>>;

export interface SuppressionDeclaration {
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly line: number;
  readonly ruleIds: readonly string[];
  readonly reason?: string;
}

/**
 * Scans `source` and builds a (line → set of disabled rule IDs) map.
 * Lines are 1-based.
 */
export function parseInlineDisables(source: string): DisableMap {
  return parseInlineDisablesDetailed(source).disableMap;
}

/**
 * Same as `parseInlineDisables` but also returns every pragma
 * declaration (including any captured reason text). Consumers that
 * want to surface the audit trail — e.g. `scan_project` meta — can
 * read `declarations` instead of re-parsing the source.
 */
export function parseInlineDisablesDetailed(source: string): {
  readonly disableMap: DisableMap;
  readonly declarations: readonly SuppressionDeclaration[];
} {
  const lines = source.split("\n");
  const disableMap: DisableMap = new Map();
  const declarations: SuppressionDeclaration[] = [];
  const regionStack: Array<{ ruleIds: readonly string[] }> = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNumber = idx + 1;
    const line = lines[idx] ?? "";
    applyRegionDisables(lineNumber, regionStack, disableMap);

    const pragma = findPragma(line);
    if (!pragma) continue;
    declarations.push({
      kind: pragma.kind,
      line: lineNumber,
      ruleIds: pragma.ruleIds,
      ...(pragma.reason === undefined ? {} : { reason: pragma.reason }),
    });
    handlePragma(pragma, lineNumber, regionStack, disableMap);
  }
  return { disableMap, declarations };
}

interface PragmaMatch {
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly ruleIds: readonly string[];
  readonly reason?: string;
}

function findPragma(line: string): PragmaMatch | null {
  for (const pattern of COMMENT_PATTERNS) {
    const m = pattern.exec(line);
    if (!m) continue;
    const directive = m[1];
    const tail = m[2] ?? "";
    if (!directive) return null;
    const { ruleIds, reason } = splitRuleListAndReason(tail);
    return {
      kind: pragmaKind(directive),
      ruleIds,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  return null;
}

function pragmaKind(directive: string): PragmaMatch["kind"] {
  if (directive === "ra11y-disable-next-line") return "disable-next-line";
  if (directive === "ra11y-enable") return "enable";
  return "disable";
}

/**
 * Separates the rule-IDs portion of a pragma from the optional reason.
 * The first `:` that is not part of a criterion ID (`wcag22:2.4.5`) or
 * the first `--` sequence terminates the list; everything after is
 * captured as free-form reason text. Blank reasons are normalized to
 * undefined so the declaration stays shaped-terse.
 */
function splitRuleListAndReason(tail: string): {
  readonly ruleIds: readonly string[];
  readonly reason?: string;
} {
  const split = findReasonBoundary(tail);
  const head = split === null ? tail : tail.slice(0, split.index);
  const reasonRaw = split === null ? "" : tail.slice(split.index + split.len);
  const ruleIds = parseRuleList(head);
  const reason = normalizeReason(reasonRaw);
  return reason === undefined ? { ruleIds } : { ruleIds, reason };
}

function findReasonBoundary(tail: string): { index: number; len: number } | null {
  const dashes = tail.indexOf("--");
  let boundary: { index: number; len: number } | null =
    dashes >= 0 ? { index: dashes, len: 2 } : null;
  // Criterion IDs use `<standard>:<number>` — the char after the `:`
  // is always a digit (e.g. `wcag22:2.4.5`). A colon that is NOT
  // followed by a digit is therefore the reason separator. Rule IDs
  // use `/`, not `:`, so this rule is unambiguous.
  const colonPattern = /:(?!\d)/g;
  const colonMatch = colonPattern.exec(tail);
  if (colonMatch !== null && (boundary === null || colonMatch.index < boundary.index)) {
    boundary = { index: colonMatch.index, len: 1 };
  }
  return boundary;
}

function normalizeReason(raw: string): string | undefined {
  // Strip trailing `*/`, `-->`, or `}` tokens that belong to the
  // comment syntax, then collapse whitespace. Empty reasons become
  // undefined so downstream consumers can distinguish "no reason
  // supplied" from "empty reason string".
  const stripped = raw
    .replace(/\*\/\s*\}?\s*$/, "")
    .replace(/-->\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length === 0 ? undefined : stripped;
}

function parseRuleList(tail: string): readonly string[] {
  const tokens = tail
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith("*/") && !t.startsWith("-->"));
  return tokens.length === 0 ? ["*"] : tokens;
}

function handlePragma(
  pragma: PragmaMatch,
  lineNumber: number,
  regionStack: Array<{ ruleIds: readonly string[] }>,
  disableMap: DisableMap,
): void {
  if (pragma.kind === "disable-next-line") {
    addToLine(disableMap, lineNumber + 1, pragma.ruleIds);
    return;
  }
  if (pragma.kind === "disable") {
    regionStack.push({ ruleIds: pragma.ruleIds });
    return;
  }
  // "enable" — pop the most recent matching disable. If the enable
  // specifies rule IDs, we pop the most recent disable that started
  // with an intersecting rule set. For simplicity, we pop the top
  // region regardless of specificity — rules can choose to narrow
  // their own region with a new disable.
  regionStack.pop();
}

function addToLine(disableMap: DisableMap, line: number, ruleIds: readonly string[]): void {
  let set = disableMap.get(line);
  if (!set) {
    set = new Set();
    disableMap.set(line, set);
  }
  for (const ruleId of ruleIds) set.add(ruleId);
}

function applyRegionDisables(
  lineNumber: number,
  regionStack: ReadonlyArray<{ ruleIds: readonly string[] }>,
  disableMap: DisableMap,
): void {
  if (regionStack.length === 0) return;
  for (const region of regionStack) {
    addToLine(disableMap, lineNumber, region.ruleIds);
  }
}
