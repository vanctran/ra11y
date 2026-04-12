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
 * Comment styles supported: `//`, `/* … *\/`, `<!-- … -->` (HTML).
 * JSX `{/* … *\/}` is also recognized.
 *
 * Returns a `(line → Set<ruleId>)` map the engine's context-builder
 * consumes via `ctx.isDisabled(line, ruleId)`. A set containing
 * `"*"` means "all rules disabled on this line".
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

/**
 * Scans `source` and builds a (line → set of disabled rule IDs) map.
 * Lines are 1-based.
 */
export function parseInlineDisables(source: string): DisableMap {
  const lines = source.split("\n");
  const disableMap: DisableMap = new Map();
  const regionStack: Array<{ ruleIds: readonly string[] }> = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNumber = idx + 1;
    const line = lines[idx] ?? "";
    applyRegionDisables(lineNumber, regionStack, disableMap);

    const pragma = findPragma(line);
    if (!pragma) continue;
    handlePragma(pragma, lineNumber, regionStack, disableMap);
  }
  return disableMap;
}

interface PragmaMatch {
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly ruleIds: readonly string[];
}

function findPragma(line: string): PragmaMatch | null {
  for (const pattern of COMMENT_PATTERNS) {
    const m = pattern.exec(line);
    if (!m) continue;
    const directive = m[1];
    const tail = m[2] ?? "";
    if (!directive) return null;
    return { kind: pragmaKind(directive), ruleIds: parseRuleList(tail) };
  }
  return null;
}

function pragmaKind(directive: string): PragmaMatch["kind"] {
  if (directive === "ra11y-disable-next-line") return "disable-next-line";
  if (directive === "ra11y-enable") return "enable";
  return "disable";
}

function parseRuleList(tail: string): readonly string[] {
  // Strip trailing reason comments like `-- reason: ...`
  const withoutReason = tail.split(/--|reason:/i)[0] ?? "";
  const tokens = withoutReason
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith("*/"));
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
