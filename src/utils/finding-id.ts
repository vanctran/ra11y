/**
 * Stable finding identity.
 *
 * Every {@link import("../types/violation.ts").Violation} carries a
 * `findingId: string` — the same opaque token across re-runs of the
 * same scan, so an agent can verify "did my edit close finding X?" by
 * exact identity rather than fuzzy `(file, line, ruleId)` matching
 * that breaks when line numbers shift after an unrelated edit.
 *
 * Recipe:
 *   findingId = sha256(
 *     ruleId + "\0" + relativeFilePath + "\0" + lineContextHash
 *   ).slice(0, 12)
 *
 * where `lineContextHash` is the sha256 of the source text for a
 * window of `±FINDING_CONTEXT_RADIUS` lines around the violation,
 * with each line's trailing whitespace stripped. Line numbers are
 * NOT part of the input by design — the whole point is resilience
 * to line-number drift that happens when unrelated code is inserted
 * above the violation.
 *
 * Path normalization: the hash input is always relative — absolute
 * paths break across machines (CI vs developer laptop vs sandbox).
 * When `scanRoot` is provided and the `filePath` is absolute under
 * that root, the relative form is used; otherwise the `filePath` is
 * normalized in place (backslashes → forward slashes; leading `./`
 * stripped) so the same logical path produces the same hash on
 * Windows and POSIX.
 *
 * Length: 12 hex chars = 48 bits. For a single scan producing tens
 * of thousands of violations, the birthday-collision probability is
 * still under 1e-6, and a 48-bit token reads cleanly in agent
 * transcripts and diff output. Full sha256 is available internally
 * if ever needed.
 */

import { createHash } from "node:crypto";
import { isAbsolute, relative as relativePath } from "node:path";

/** Number of lines before and after the violation line included in the source-context window. */
export const FINDING_CONTEXT_RADIUS = 3;

/** Output length (hex chars) of the truncated sha256 digest. */
export const FINDING_ID_LENGTH = 12;

export interface FindingIdInputs {
  readonly ruleId: string;
  readonly filePath: string;
  /** Full source text of the file. May be empty for synthetic violations. */
  readonly source: string;
  /** 1-based line number of the violation. */
  readonly line: number;
  /**
   * Absolute or logical "scan root" for path relativization. When
   * omitted, the `filePath` is normalized in place without
   * relativization. Callers that know their root (scanner, CLI) pass
   * it; callers that don't (tests, synthetic emitters) don't.
   */
  readonly scanRoot?: string;
}

/**
 * Computes the stable finding ID for a violation. Pure function over
 * its inputs; no I/O.
 */
export function computeFindingId(inputs: FindingIdInputs): string {
  const path = normalizeRelativePath(inputs.filePath, inputs.scanRoot);
  const contextHash = computeLineContextHash(inputs.source, inputs.line);
  const canonical = `${inputs.ruleId}\u0000${path}\u0000${contextHash}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, FINDING_ID_LENGTH);
}

/**
 * Hashes the source-text window around a given line. Exported so
 * baseline and scan-diff code can reconstruct the same identity from
 * stored inputs when needed for diagnostics. Not used in the
 * baseline wire format — baselines store the finished `findingId`.
 */
export function computeLineContextHash(source: string, line: number): string {
  const lines = source.split("\n");
  const start = Math.max(0, line - 1 - FINDING_CONTEXT_RADIUS);
  const end = Math.min(lines.length, line + FINDING_CONTEXT_RADIUS);
  const window = lines
    .slice(start, end)
    .map((l) => l.replace(/[ \t]+$/u, ""))
    .join("\n");
  return createHash("sha256").update(window).digest("hex");
}

/**
 * Normalizes a file path to a portable relative string. Absolute
 * paths break across machines; the hash has to produce the same
 * value on CI, on the user's laptop, and inside a sandbox, so we
 * always return a forward-slash relative form.
 *
 * When `scanRoot` is provided and the path resolves under it, the
 * `path.relative` form is used. Otherwise (or when no root is
 * provided), the input is normalized in place: backslashes → slashes,
 * leading `./` stripped.
 */
function normalizeRelativePath(filePath: string, scanRoot?: string): string {
  let normalized = filePath;
  if (scanRoot !== undefined && scanRoot.length > 0 && isAbsolute(filePath)) {
    const rel = relativePath(scanRoot, filePath);
    // `relative` can return an empty string when the paths match, or
    // `../…` when the file is outside the scan root. Empty is fine
    // (collapse to the filename); `..` we accept verbatim.
    if (rel.length > 0) normalized = rel;
  }
  return normalized.replace(/\\/g, "/").replace(/^\.\//, "");
}
