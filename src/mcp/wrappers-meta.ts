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

export interface NativeWrapperSources {
  /** From ra11y.config.ts. */
  readonly fromFile: readonly string[];
  /** Added via configure() calls this session. */
  readonly fromSession: readonly string[];
  /**
   * Auto-detected for THIS scan only (e.g. scan_project's
   * `autoDetectWrappers: true`). Tracked separately so the
   * session-override audit (`sessionNativeWrappers` +
   * `sessionOverridesNote`) doesn't mis-attribute them to a stale
   * configure() call. Scan-scoped by contract — never touches
   * session.config.
   */
  readonly fromAutoDetect?: readonly string[];
}

export interface ResolvedWrapperSources {
  readonly wrappers: readonly string[];
  readonly sessionOnly: readonly string[];
  readonly bySource: {
    readonly fromConfig: readonly string[];
    readonly fromSession: readonly string[];
    readonly fromAutoDetect: readonly string[];
  };
}

/**
 * Merges the three native-wrapper sources (config file, session,
 * auto-detect) and derives the session-only audit list used for the
 * `sessionNativeWrappers` meta warning. Auto-detected wrappers are
 * deliberately excluded from `sessionOnly` — they come from this scan,
 * not a stale configure() call, and flow into their own
 * `autoDetectedWrappers` meta block.
 */
export function resolveWrapperSources(
  wrapperSources: NativeWrapperSources | undefined,
  session: McpSession,
): ResolvedWrapperSources {
  const sources: NativeWrapperSources = wrapperSources ?? {
    fromFile: [],
    fromSession: session.config.nativeWrappers,
  };
  const autoDetect = sources.fromAutoDetect ?? [];
  const wrappers = [...new Set([...sources.fromFile, ...sources.fromSession, ...autoDetect])];
  const sessionOnly = sources.fromSession.filter((w) => !sources.fromFile.includes(w));
  // Surface each source verbatim so the agent can answer "why is X
  // active?" / "can I remove this from ra11y.config.ts?" in one read.
  // Names overlap freely across sources — a wrapper in both config and
  // session stays active if either source is removed.
  const bySource = {
    fromConfig: [...sources.fromFile].sort(),
    fromSession: [...sources.fromSession].sort(),
    fromAutoDetect: [...autoDetect].sort(),
  };
  return { wrappers, sessionOnly, bySource };
}

/**
 * Assembles the wrapper-related meta block: activeNativeWrappers +
 * provenance (bySource) + session-only audit + unused-in-config audit.
 * Each sub-block is conditionally included only when there's content
 * to report — no sentinel-empty fields.
 */
export function wrappersMetaBlock(args: {
  wrappers: readonly string[];
  sessionOnly: readonly string[];
  unusedWrappers: readonly string[];
  wrapperProvenance: ResolvedWrapperSources["bySource"];
}): Record<string, unknown> {
  const { wrappers, sessionOnly, unusedWrappers, wrapperProvenance } = args;
  const out: Record<string, unknown> = {};
  if (wrappers.length > 0) {
    out["activeNativeWrappers"] = [...wrappers];
    // Provenance map: the three sources whose union feeds
    // activeNativeWrappers. Surfaced so "why is X active?" and
    // "can I remove this from ra11y.config.ts?" are answerable from
    // one read. Names overlap freely — a wrapper in config AND
    // session stays active if either source is removed. Empty lists
    // are omitted.
    const bySource: Record<string, readonly string[]> = {};
    if (wrapperProvenance.fromConfig.length > 0)
      bySource["fromConfig"] = wrapperProvenance.fromConfig;
    if (wrapperProvenance.fromSession.length > 0)
      bySource["fromSession"] = wrapperProvenance.fromSession;
    if (wrapperProvenance.fromAutoDetect.length > 0)
      bySource["fromAutoDetect"] = wrapperProvenance.fromAutoDetect;
    out["activeNativeWrappersBySource"] = bySource;
  }
  if (sessionOnly.length > 0) {
    // Split visibility: agents editing ra11y.config.ts need to see when
    // a session configure() call is layering extras on top of the file.
    // Without this, an ad-hoc "add Button for this session" persists
    // silently even after the file is edited to remove it.
    out["sessionNativeWrappers"] = sessionOnly;
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
      // substrings like `<NameMore>` or `ActionButtonGroup`.
      const pattern = new RegExp(`<${name}(?=[\\s/>])`);
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
 * configured wrapper. A wrapper is "used" the moment it appears as a
 * JSX element anywhere in the scanned source — independent of whether
 * any rule fired against it.
 */
function collectUsedWrappers(
  files: readonly ParsedFile[],
  nativeWrappers: readonly string[],
): ReadonlySet<string> {
  const allow = new Set(nativeWrappers);
  const used = new Set<string>();
  for (const file of files) {
    if (file.ast.language === "html" || file.ast.language === "css") continue;
    for (const el of walkJsxElements(file.ast.root)) {
      if (allow.has(el.tagName)) used.add(el.tagName);
    }
  }
  return used;
}
