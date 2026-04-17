/**
 * Top-level `warnings: string[]` codes for MCP scan responses.
 *
 * Closes the "clean codebase vs tool never ran" ambiguity described in
 * CLAUDE.md §1 "Zero-output success is ambiguous failure" — an agent
 * that calls `scan_project({ cwd: "/tmp/wrong-path" })` currently gets
 * a successful empty result that looks like a clean codebase. Each code
 * below names one plausible-malformed-input condition; callers emit
 * only the codes whose conditions hold and omit the field entirely when
 * none do (conditional spread at the assembly site — never `warnings: []`).
 *
 * Codes are stable identifiers, not English. Agents branch on the code;
 * the prose of "why this fired" lives in the same response's `meta`
 * fields (`rootSource`, `configSource`, `analysisCoverage.hints`, etc.)
 * which the warning implicitly points at.
 */

export type ScanWarningCode =
  | "scanned_zero_files"
  | "root_source_defaulted"
  | "no_config_found"
  | "tailwind_detected_css_undercounted"
  | "template_files_parsed_as_literal";

export interface WarningInputs {
  /** Count of parseable files the scan actually evaluated. */
  readonly filesScanned: number;
  /**
   * How the scan root was resolved. "explicit" (caller passed `cwd`) and
   * "host-root" (MCP host declared a root) are deliberate. "git" and
   * "spawn-cwd" are fallbacks off the server's spawn directory — the
   * canonical silent-failure vector. Pass `null` when the tool has no
   * root-resolution step (e.g. `scan`, which takes `paths` directly).
   */
  readonly rootSource: "explicit" | "host-root" | "git" | "spawn-cwd" | null;
  /**
   * Resolved `configSource` from `loadProjectConfig`. `null` means the
   * walk-up completed and found nothing; pass `undefined` when the tool
   * did not attempt config resolution at all (rare — currently neither
   * `scan` nor `scan_project` skip it).
   */
  readonly configSource: string | null | undefined;
  /**
   * The analysisCoverage block as returned by `buildAnalysisCoverage` —
   * we read `hints` for the Tailwind signal and `templateDirectivesFound`
   * for the literal-template signal. Pass the full block; the helper
   * does the field lookups so callers don't duplicate them.
   */
  readonly analysisCoverage: Record<string, unknown> | undefined;
  /**
   * `meta.filesByExtension` as returned by `runScanAndFormat`. Used to
   * evaluate the Tailwind-vs-CSS-undercount condition without re-parsing.
   */
  readonly filesByExtension: Readonly<Record<string, number>> | undefined;
}

/** Threshold below which a Tailwind-detected codebase is considered CSS-undercounted. */
const TAILWIND_CSS_UNDERCOUNT_THRESHOLD = 3;

/**
 * Returns the codes whose conditions hold, in declaration order. Callers
 * conditional-spread the result: `...(warnings.length ? { warnings } : {})`.
 */
export function computeScanWarnings(inputs: WarningInputs): readonly ScanWarningCode[] {
  const out: ScanWarningCode[] = [];
  if (inputs.filesScanned === 0) out.push("scanned_zero_files");
  if (inputs.rootSource === "git" || inputs.rootSource === "spawn-cwd") {
    out.push("root_source_defaulted");
  }
  if (inputs.configSource === null) out.push("no_config_found");
  if (
    hasTailwindHint(inputs.analysisCoverage) &&
    cssCount(inputs.filesByExtension) < TAILWIND_CSS_UNDERCOUNT_THRESHOLD
  ) {
    out.push("tailwind_detected_css_undercounted");
  }
  if (hasTemplateDirectives(inputs.analysisCoverage)) {
    // Templates are only detected while walking HTML files in the parsed
    // set, so `templateDirectivesFound` populating implies the scanner
    // saw at least one template file. The warning restates that the
    // parser treated the directives as literal text — a fact already in
    // `templateDirectiveHandling` but easy to miss in the meta block.
    out.push("template_files_parsed_as_literal");
  }
  return out;
}

function hasTailwindHint(coverage: Record<string, unknown> | undefined): boolean {
  if (coverage === undefined) return false;
  const hints = coverage["hints"];
  if (!Array.isArray(hints)) return false;
  for (const hint of hints) {
    if (typeof hint === "string" && hint.includes("Tailwind usage detected")) return true;
  }
  return false;
}

function cssCount(filesByExtension: Readonly<Record<string, number>> | undefined): number {
  if (filesByExtension === undefined) return 0;
  return filesByExtension[".css"] ?? 0;
}

function hasTemplateDirectives(coverage: Record<string, unknown> | undefined): boolean {
  if (coverage === undefined) return false;
  const directives = coverage["templateDirectivesFound"];
  return Array.isArray(directives) && directives.length > 0;
}

/**
 * Builds `WarningInputs` from a `formatted.meta` block. Both `scan` and
 * `scan_project` assemble the same five fields from the same shape, so
 * the narrowing lives here rather than being duplicated at each call
 * site. Caller supplies `rootSource` + `configSource` — both known
 * outside the scan pipeline — and this function pulls the rest out of
 * the meta block that `runScanAndFormat` already produced.
 */
export function warningsFromScanMeta(args: {
  readonly meta: Record<string, unknown>;
  readonly rootSource: WarningInputs["rootSource"];
  readonly configSource: string | null | undefined;
}): readonly ScanWarningCode[] {
  return computeScanWarnings({
    filesScanned: readNumber(args.meta, "filesScanned"),
    rootSource: args.rootSource,
    configSource: args.configSource,
    analysisCoverage: readRecord(args.meta, "analysisCoverage"),
    filesByExtension: readNumberRecord(args.meta, "filesByExtension"),
  });
}

/**
 * Returns the spreadable response field — `{ warnings: [...] }` when at
 * least one code fired, `{}` otherwise. Lets call sites collapse the
 * compute + conditional-spread to a single `...warningsField(...)`,
 * keeping the handler's cognitive complexity flat.
 */
export function warningsField(inputs: WarningInputs): {
  readonly warnings?: readonly ScanWarningCode[];
} {
  const codes = computeScanWarnings(inputs);
  return codes.length > 0 ? { warnings: codes } : {};
}

/**
 * Same as `warningsField` but reads inputs out of a scan meta block.
 * Used by the post-scan main branch where the meta is already built.
 */
export function warningsFieldFromScanMeta(args: {
  readonly meta: Record<string, unknown>;
  readonly rootSource: WarningInputs["rootSource"];
  readonly configSource: string | null | undefined;
}): { readonly warnings?: readonly ScanWarningCode[] } {
  const codes = warningsFromScanMeta(args);
  return codes.length > 0 ? { warnings: codes } : {};
}

function readNumber(meta: Record<string, unknown>, key: string): number {
  const v = meta[key];
  return typeof v === "number" ? v : 0;
}

function readRecord(
  meta: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = meta[key];
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function readNumberRecord(
  meta: Record<string, unknown>,
  key: string,
): Record<string, number> | undefined {
  const v = meta[key];
  if (v === null || typeof v !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number") out[k] = val;
  }
  return out;
}
