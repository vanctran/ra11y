/**
 * Wrapper-metadata helpers: resolve native-wrapper sources into the
 * flat "active" list and source-map, assemble the meta block the
 * tool responses return, and detect wrappers that appear unused.
 *
 * Extracted from tools-helpers.ts to keep that file under the 500-line
 * limit — these helpers share domain (native wrappers) and are
 * naturally cohesive.
 */

import { readFile } from "node:fs/promises";
import { walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { discoverFiles } from "../input/discover.ts";
import type { McpSession } from "./session.ts";
import { matchesWrapperPattern, wrapperPatternToTagRegexSource } from "./wrapper-matcher.ts";

/**
 * Auto-detected wrapper candidates split by the one-hop AST probe
 * from {@link classifyWrapperCandidates} (P1-F). `confirmed` wrappers
 * flow into the effective allowlist and silently silence findings;
 * `assumed` wrappers stay opaque (rules fire as if the name were NOT
 * in the wrapper list) but are still surfaced in the response so the
 * agent can see the candidate and verify by reading the source.
 */
export interface AutoDetectedWrappers {
  readonly confirmed: readonly string[];
  readonly assumed: readonly string[];
}

export interface NativeWrapperSources {
  /** From ra11y.config.ts. */
  readonly fromFile: readonly string[];
  /** Added via configure() calls this session. */
  readonly fromSession: readonly string[];
  /**
   * Auto-detected for THIS scan only (e.g. scan_project's
   * `autoDetectWrappers: true`). Tracked separately so the
   * session-override audit (`sessionOverridesNote` + the
   * `source: "session"` entries in the unified `activeNativeWrappers`
   * list) doesn't mis-attribute them to a stale configure() call.
   * Scan-scoped by contract — never touches session.config.
   *
   * Split into `confirmed` vs `assumed` so that only confirmed
   * wrappers (those whose defining file's JSX root is a native
   * interactive element) silence findings. Assumed wrappers stay
   * opaque so rules still fire on them — see
   * {@link AutoDetectedWrappers} and CLAUDE.md §1.
   */
  readonly fromAutoDetect?: AutoDetectedWrappers;
}

export interface ResolvedWrapperSources {
  /**
   * The effective native-wrapper allowlist for this scan — the union
   * of config, session, and auto-detect *confirmed* names. Assumed
   * auto-detect names are deliberately NOT included; they stay
   * opaque.
   */
  readonly wrappers: readonly string[];
  readonly sessionOnly: readonly string[];
  readonly bySource: {
    readonly fromConfig: readonly string[];
    readonly fromSession: readonly string[];
    readonly fromAutoDetect: AutoDetectedWrappers;
  };
}

/**
 * Merges the three native-wrapper sources (config file, session,
 * auto-detect) and derives the session-only audit list used for the
 * `sessionOverridesNote` meta warning. Auto-detected wrappers are
 * deliberately excluded from `sessionOnly` — they come from this scan,
 * not a stale configure() call, and flow into their own
 * `autoDetectedWrappers` meta block.
 *
 * Auto-detect names are split into `confirmed` vs `assumed` by a
 * one-hop AST probe before reaching this function. Only `confirmed`
 * names flow into the active-wrapper allowlist; `assumed` names are
 * preserved in `bySource.fromAutoDetect.assumed` so the agent sees the
 * candidate but the scanner does not silently trust it.
 */
export function resolveWrapperSources(
  wrapperSources: NativeWrapperSources | undefined,
  session: McpSession,
): ResolvedWrapperSources {
  const sources: NativeWrapperSources = wrapperSources ?? {
    fromFile: [],
    fromSession: session.config.nativeWrappers,
  };
  const autoDetect: AutoDetectedWrappers = sources.fromAutoDetect ?? {
    confirmed: [],
    assumed: [],
  };
  // Only CONFIRMED auto-detect names flow into the effective
  // allowlist. Assumed names are intentionally excluded — their
  // findings stay live so the agent (and the rest of the scanner)
  // treats them like any other opaque PascalCase component.
  const wrappers = [
    ...new Set([...sources.fromFile, ...sources.fromSession, ...autoDetect.confirmed]),
  ];
  const sessionOnly = sources.fromSession.filter((w) => !sources.fromFile.includes(w));
  // Surface each source verbatim so the agent can answer "why is X
  // active?" / "can I remove this from ra11y.config.ts?" in one read.
  // Names overlap freely across sources — a wrapper in both config and
  // session stays active if either source is removed.
  const bySource = {
    fromConfig: [...sources.fromFile].sort(),
    fromSession: [...sources.fromSession].sort(),
    fromAutoDetect: {
      confirmed: [...autoDetect.confirmed].sort(),
      assumed: [...autoDetect.assumed].sort(),
    },
  };
  return { wrappers, sessionOnly, bySource };
}

/**
 * The wrapper source tag. `source` names the channel the wrapper was
 * registered through for this scan — `"config"` for ra11y.config.ts,
 * `"autoDetect"` for an inline `autoDetectWrappers: true` pass, and
 * `"session"` for a prior `configure()` call layered on top of the
 * file. One entry is emitted per (name × channel) so a name declared
 * in two channels appears twice — agents triaging "why is X active?"
 * see every channel independently.
 */
export type WrapperSource = "config" | "autoDetect" | "session";

/**
 * One entry in the unified `activeNativeWrappers` tagged list (Q2R2-
 * WRAPPER-SOURCES). Replaces the former trio of `activeNativeWrappers:
 * string[]` + `activeNativeWrappersBySource: { fromConfig, fromSession,
 * fromAutoDetect }` + `sessionNativeWrappers: string[]` with one shape
 * the agent can iterate without cross-referencing three fields.
 *
 * `confirmed` is populated ONLY for `source: "autoDetect"` entries
 * (P1-F): `true` when the one-hop AST probe found a native interactive
 * root in the defining file, `false` when the probe could not confirm
 * and the name stays opaque (rules still fire on it). Omitted for
 * `"config"` and `"session"` — those are author-supplied, so the
 * confirmed-vs-assumed distinction does not apply. Conditional-spread
 * at the assembly site per CLAUDE.md §1 "Ambiguous field shapes are
 * dishonest."
 */
export interface ActiveNativeWrapper {
  readonly name: string;
  readonly source: WrapperSource;
  readonly confirmed?: boolean;
}

/**
 * Assembles the wrapper-related meta block: a unified tagged
 * `activeNativeWrappers` list, the session-override audit prose, and
 * the unused-in-config audit. Each sub-block is conditionally
 * included only when there's content to report — no sentinel-empty
 * fields.
 */
export function wrappersMetaBlock(args: {
  sessionOnly: readonly string[];
  unusedWrappers: readonly string[];
  wrapperProvenance: ResolvedWrapperSources["bySource"];
}): Record<string, unknown> {
  const { sessionOnly, unusedWrappers, wrapperProvenance } = args;
  const out: Record<string, unknown> = {};
  // The surface contract: emit `activeNativeWrappers` when ANY wrapper
  // signal is present — including auto-detect `assumed` names that
  // don't reach the effective allowlist. Without this, a scan that
  // found only assumed wrappers would look identical to a scan with
  // none, hiding the "here's what I considered but didn't trust"
  // signal the agent needs to investigate.
  const entries = buildActiveWrapperEntries(wrapperProvenance);
  if (entries.length > 0) out["activeNativeWrappers"] = entries;
  if (sessionOnly.length > 0) {
    // Agents editing ra11y.config.ts need to know when a session
    // configure() call is layering extras on top of the file — without
    // this prose, an ad-hoc "add Button for this session" persists
    // silently even after the file is edited to remove it. The
    // per-entry `source: "session"` tag in `activeNativeWrappers`
    // surfaces which names are session-only; this note explains the
    // operational consequence.
    out["sessionOverridesNote"] =
      `${sessionOnly.length} wrapper${sessionOnly.length === 1 ? "" : "s"} added by this session's configure() call, not in ra11y.config.ts. If you've since removed these from the file, the session additions still apply for this connection — restart the MCP server or call configure() again to sync.`;
  }
  if (unusedWrappers.length > 0) {
    // Surface wrappers registered in config that didn't match any
    // component this run. Helps catch config rot — a renamed/deleted
    // component whose allowlist entry lingers and silently does
    // nothing.
    out["unusedNativeWrappers"] = unusedWrappers;
    out["unusedNativeWrappersNote"] =
      "Components listed in nativeWrappers that weren't found in any scanned or scan-adjacent source file under cwd. Not an error — the component may live in a path the scan never reaches (outside the project root, or under a custom exclude). If the component was renamed or deleted, update or remove the entry in ra11y.config.ts; otherwise ignore.";
  }
  return out;
}

/**
 * Folds the `{fromConfig, fromSession, fromAutoDetect}` provenance
 * into the unified tagged list. One entry per (name × channel) — a
 * name declared in both config and session emits two entries so the
 * agent sees every origin independently. Deterministic order: by
 * source (`config` < `autoDetect` < `session`), then by name. Within
 * `autoDetect`, confirmed entries come before assumed so the agent
 * reads the trusted subset first.
 *
 * `confirmed` rides along only for `autoDetect` entries (P1-F — the
 * probe is the only channel that can produce this flag). Config and
 * session entries omit the field entirely per CLAUDE.md §1 "Ambiguous
 * field shapes are dishonest": `confirmed` on an author-supplied name
 * would be noise at best and a silent lie at worst.
 */
function buildActiveWrapperEntries(
  provenance: ResolvedWrapperSources["bySource"],
): readonly ActiveNativeWrapper[] {
  const out: ActiveNativeWrapper[] = [];
  for (const name of [...provenance.fromConfig].sort()) {
    out.push({ name, source: "config" });
  }
  for (const name of [...provenance.fromAutoDetect.confirmed].sort()) {
    out.push({ name, source: "autoDetect", confirmed: true });
  }
  for (const name of [...provenance.fromAutoDetect.assumed].sort()) {
    out.push({ name, source: "autoDetect", confirmed: false });
  }
  for (const name of [...provenance.fromSession].sort()) {
    out.push({ name, source: "session" });
  }
  return out;
}

/**
 * Returns the wrappers that appear nowhere — neither in the scanned
 * files (AST-level check) nor, when a project root is given, in paths
 * the scanner excluded by default (text-level check).
 */
export async function resolveUnusedWrappers(
  wrappers: readonly string[],
  files: readonly ParsedFile[],
  cwd: string | undefined,
): Promise<readonly string[]> {
  if (wrappers.length === 0) return [];
  const used = new Set(collectUsedWrappers(files, wrappers));
  const stillCandidate = wrappers.filter((w) => !used.has(w));
  if (cwd && stillCandidate.length > 0) {
    const scanned = new Set(files.map((f) => f.filePath));
    const widened = await findWrappersInExcludedSources(cwd, stillCandidate, scanned);
    for (const name of widened) used.add(name);
  }
  return wrappers.filter((w) => !used.has(w));
}

/**
 * Text-based best-effort search for wrapper usages in files the scan
 * excluded (stories, dev-tools, tests). Matches `<Wrapper ` or
 * `<Wrapper>` or `<Wrapper/>` as a whole-token. Cheap: reads each file
 * once, regex short-circuits on first hit per wrapper.
 *
 * This is a transparency fix, not a correctness-critical signal — a
 * false negative only means we warn about a config entry that isn't
 * actually stale.
 */
async function findWrappersInExcludedSources(
  cwd: string,
  candidates: readonly string[],
  alreadyScanned: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const remaining = new Set(candidates);
  // Re-discover with every default exclusion turned off so we see
  // stories/dev-tools/tests. .gitignore still applies — we don't want
  // to read node_modules or build output.
  const all = await discoverFiles([cwd], { includeTests: true });
  for (const path of all) {
    if (remaining.size === 0) break;
    if (alreadyScanned.has(path)) continue;
    if (!/\.(tsx|jsx|ts|js)$/i.test(path)) continue;
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const name of remaining) {
      // `<Name` followed by whitespace, `/`, or `>` — avoids matching
      // substrings like `<NameMore>` or `ActionButtonGroup`. `name`
      // may be a glob like `*Button` / `Icon*`; the helper returns
      // the regex-safe body that honors the wildcard.
      const pattern = new RegExp(`<${wrapperPatternToTagRegexSource(name)}(?=[\\s/>])`);
      if (pattern.test(source)) {
        found.add(name);
        remaining.delete(name);
      }
    }
  }
  return found;
}

/**
 * Walks every parsed TSX module for JSX element tag names matching a
 * configured wrapper pattern. A wrapper pattern is "used" the moment
 * any JSX element tag matches it anywhere in the scanned source —
 * independent of whether any rule fired against that element. Returns
 * the set of PATTERNS that matched (not individual tag names), so a
 * pattern like `*Button` counts as used when `IconButton` or
 * `BigButton` appears.
 */
function collectUsedWrappers(
  files: readonly ParsedFile[],
  nativeWrappers: readonly string[],
): ReadonlySet<string> {
  const usedPatterns = new Set<string>();
  const remaining = new Set(nativeWrappers);
  for (const file of files) {
    if (file.ast.language === "html" || file.ast.language === "css") continue;
    if (remaining.size === 0) break;
    for (const el of walkJsxElements(file.ast.root)) {
      for (const pattern of remaining) {
        if (matchesWrapperPattern(el.tagName, pattern)) {
          usedPatterns.add(pattern);
          remaining.delete(pattern);
        }
      }
    }
  }
  return usedPatterns;
}
