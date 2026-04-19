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
  | "template_files_parsed_as_literal"
  | "scanned_build_artifacts_present"
  // scan_diff hunksOnly mode: the comparison ref resolved but produced
  // no hunks (e.g. clean working tree against HEAD). Zero findings in
  // this shape would otherwise read as "clean codebase" — the warning
  // tells the agent the comparison was a no-op, not a green scan.
  | "no_hunks_in_comparison"
  // `preset: "storybook"` engaged on this scan. Surfaced honestly
  // (not suppressed) so an agent reading the response can tell that
  // non-default behavior was active — story files were included in
  // discovery AND Storybook primitives (`Meta`, `StoryObj`, `StoryFn`,
  // `Story`) were rendered transparent in the opaque-component
  // telemetry. Not an error; a label the agent can branch on.
  | "storybook_preset_active";

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
  /**
   * True when `scan_project` detected at least one compiled-CSS /
   * bundler-output file among the scanned set (see
   * `collectBuildArtifacts` in `./build-artifacts.ts`). Callers that
   * don't run the detector (e.g. `scan` against arbitrary paths)
   * should pass `false`. The corresponding code
   * `scanned_build_artifacts_present` is a label, not a filter — the
   * findings on those files are still in `formatted.files`; the code
   * just tells the agent "at least one of your scanned files came
   * from the build."
   */
  readonly scannedBuildArtifactsPresent?: boolean;
  /**
   * True when the resolved project config has `preset: "storybook"`.
   * Drives the `storybook_preset_active` warning — an honest label
   * that framework-aware transparency engaged for this scan (story
   * files discovered, Storybook primitives treated transparently).
   * Omitted or `false` when the preset did not apply.
   */
  readonly storybookPresetActive?: boolean;
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
  if (inputs.scannedBuildArtifactsPresent === true) {
    // The detector uses deterministic signals (escape-bracket Tailwind
    // selectors, compiled-CSS size threshold, bundler-output path
    // markers) so the label is safe to surface alongside the findings.
    // The paths themselves live in `meta.scannedBuildArtifacts`; this
    // warning code is the top-level presence signal an agent can branch
    // on without reading into meta.
    out.push("scanned_build_artifacts_present");
  }
  if (inputs.storybookPresetActive === true) {
    // Honest label: `preset: "storybook"` engaged framework-aware
    // transparency for this scan (story-file discovery on, Storybook
    // primitives rendered transparent in opaque-component
    // telemetry). The label fires whenever the preset applies,
    // regardless of whether any story file was actually found — an
    // agent reading the response can tell the non-default code path
    // ran without inspecting `configSource` or the opaque-component
    // block.
    out.push("storybook_preset_active");
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
  readonly scannedBuildArtifactsPresent?: boolean;
  readonly storybookPresetActive?: boolean;
}): readonly ScanWarningCode[] {
  return computeScanWarnings({
    filesScanned: readNumber(args.meta, "filesScanned"),
    rootSource: args.rootSource,
    configSource: args.configSource,
    analysisCoverage: readRecord(args.meta, "analysisCoverage"),
    filesByExtension: readNumberRecord(args.meta, "filesByExtension"),
    ...(args.scannedBuildArtifactsPresent === undefined
      ? {}
      : { scannedBuildArtifactsPresent: args.scannedBuildArtifactsPresent }),
    ...(args.storybookPresetActive === undefined
      ? {}
      : { storybookPresetActive: args.storybookPresetActive }),
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
  readonly scannedBuildArtifactsPresent?: boolean;
  readonly storybookPresetActive?: boolean;
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
