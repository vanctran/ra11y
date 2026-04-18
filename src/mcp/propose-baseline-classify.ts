/**
 * Classification helpers for `tool-propose-baseline.ts`. Split out so
 * the main tool module stays under the commit-size cap. The five
 * reason codes and their rationale wording are the agent-visible
 * surface; every shape change here is a wire-shape change.
 */

import { relative } from "node:path";
import type { Violation } from "../types/violation.ts";
import type { compileGlobs } from "../utils/glob.ts";

/**
 * The five reason codes the tool emits. Kept as a union literal rather
 * than an enum so the wire shape is plain strings agents can branch on
 * without importing a type.
 */
export type BaselineReason =
  | "wrapper-undetected"
  | "third-party-html"
  | "legacy-route"
  | "design-system-internal"
  | "unclassified";

/**
 * Path substrings that mark a file as third-party HTML/JS/CSS. Each
 * entry is a directory segment check — a file under `/node_modules/`
 * anywhere in its absolute path matches, independent of repo layout.
 */
const THIRD_PARTY_PATH_MARKERS: readonly string[] = ["/node_modules/", "/vendor/", "/.yarn/"];

/**
 * Suffixes that mark a file as a minified third-party asset. Minified
 * files are definitionally not hand-edited; grandfathering violations
 * there is safe.
 */
const THIRD_PARTY_MIN_SUFFIXES: readonly string[] = [".min.html", ".min.js", ".min.css"];

export interface ProposedEntry {
  readonly filePath: string;
  readonly ruleId: string;
  readonly findingId: string;
  readonly reason: BaselineReason;
  readonly rationale: string;
}

export interface ReasonCounts {
  readonly wrapperUndetected: number;
  readonly thirdPartyHtml: number;
  readonly legacyRoute: number;
  readonly designSystemInternal: number;
  readonly unclassified: number;
}

/**
 * Maps each violation to a proposed baseline entry with a reason
 * code + rationale. Precedence (first match wins):
 *
 *   1. `legacy-route`          — caller-declared glob
 *   2. `design-system-internal`— caller-declared glob
 *   3. `third-party-html`      — path substring / `.min.*` suffix
 *   4. `wrapper-undetected`    — assumed-wrapper name in message
 *   5. `unclassified`          — default
 *
 * User-declared classifications beat path heuristics; deterministic
 * path signals beat component-name heuristics. No finding is dropped
 * — every violation surfaces with a reason the agent uses to triage.
 */
export function buildProposedEntries(args: {
  readonly violations: readonly Violation[];
  readonly root: string;
  readonly assumedWrappers: ReadonlySet<string>;
  readonly legacyMatcher: ReturnType<typeof compileGlobs>;
  readonly designMatcher: ReturnType<typeof compileGlobs>;
}): readonly ProposedEntry[] {
  const { violations, root, assumedWrappers, legacyMatcher, designMatcher } = args;
  const out: ProposedEntry[] = [];
  for (const v of violations) {
    const filePath = v.location.filePath;
    const relPath = toRelPath(filePath, root);
    const reason = classifyViolation({
      filePath,
      relPath,
      message: v.message,
      assumedWrappers,
      legacyMatcher,
      designMatcher,
    });
    out.push({
      filePath,
      ruleId: v.ruleId,
      findingId: v.findingId,
      reason: reason.code,
      rationale: reason.rationale,
    });
  }
  return out;
}

interface Classification {
  readonly code: BaselineReason;
  readonly rationale: string;
}

/**
 * Returns the first matching reason code for a single violation, with
 * a one-line rationale explaining why the code was assigned. The
 * rationale is the agent's cue for whether to accept the category at
 * a glance — it names the specific evidence the scanner saw, not a
 * generic label.
 */
function classifyViolation(args: {
  readonly filePath: string;
  readonly relPath: string;
  readonly message: string;
  readonly assumedWrappers: ReadonlySet<string>;
  readonly legacyMatcher: ReturnType<typeof compileGlobs>;
  readonly designMatcher: ReturnType<typeof compileGlobs>;
}): Classification {
  const { filePath, relPath, message, assumedWrappers, legacyMatcher, designMatcher } = args;

  if (legacyMatcher.matches(relPath)) {
    return {
      code: "legacy-route",
      rationale: `Path \`${relPath}\` matches a caller-declared \`legacyRoutes\` glob.`,
    };
  }
  if (designMatcher.matches(relPath)) {
    return {
      code: "design-system-internal",
      rationale: `Path \`${relPath}\` matches a caller-declared \`designSystemPaths\` glob.`,
    };
  }
  const thirdPartyMarker = matchThirdPartyMarker(filePath);
  if (thirdPartyMarker !== null) {
    return {
      code: "third-party-html",
      rationale: `Path contains \`${thirdPartyMarker}\` — canonical third-party / minified asset location.`,
    };
  }
  const wrapperName = matchAssumedWrapperName(message, assumedWrappers);
  if (wrapperName !== null) {
    return {
      code: "wrapper-undetected",
      rationale: `Fires on \`<${wrapperName}>\` — PascalCase component the auto-detect probe considered but could not confirm as a native-element wrapper. Read the component source to decide whether to register in \`nativeWrappers\` or grandfather the finding.`,
    };
  }
  return {
    code: "unclassified",
    rationale:
      'No heuristic matched. Read the finding and decide whether to grandfather or fix before running `baseline` with mode: "create".',
  };
}

function matchThirdPartyMarker(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  for (const marker of THIRD_PARTY_PATH_MARKERS) {
    if (lower.includes(marker)) return marker;
  }
  for (const suffix of THIRD_PARTY_MIN_SUFFIXES) {
    if (lower.endsWith(suffix)) return `*${suffix}`;
  }
  return null;
}

function matchAssumedWrapperName(
  message: string,
  assumedWrappers: ReadonlySet<string>,
): string | null {
  if (assumedWrappers.size === 0) return null;
  const match = /^<([A-Z][A-Za-z0-9]*)(?=[\s>])/.exec(message);
  const name = match?.[1];
  if (name === undefined) return null;
  return assumedWrappers.has(name) ? name : null;
}

function toRelPath(filePath: string, root: string): string {
  const rel = relative(root, filePath);
  if (rel === "" || rel.startsWith("..")) return filePath;
  return rel.split("\\").join("/");
}

export function tallyReasons(entries: readonly ProposedEntry[]): ReasonCounts {
  let wrapperUndetected = 0;
  let thirdPartyHtml = 0;
  let legacyRoute = 0;
  let designSystemInternal = 0;
  let unclassified = 0;
  for (const e of entries) {
    switch (e.reason) {
      case "wrapper-undetected":
        wrapperUndetected += 1;
        break;
      case "third-party-html":
        thirdPartyHtml += 1;
        break;
      case "legacy-route":
        legacyRoute += 1;
        break;
      case "design-system-internal":
        designSystemInternal += 1;
        break;
      case "unclassified":
        unclassified += 1;
        break;
    }
  }
  return { wrapperUndetected, thirdPartyHtml, legacyRoute, designSystemInternal, unclassified };
}

export function buildProposedNextStep(total: number, counts: ReasonCounts): string {
  if (total === 0) {
    return "Scan is clean — no baseline needed. Re-run `propose_baseline` after the next regression to grandfather new findings.";
  }
  const parts: string[] = [];
  if (counts.wrapperUndetected > 0) parts.push(`${counts.wrapperUndetected} wrapper-undetected`);
  if (counts.thirdPartyHtml > 0) parts.push(`${counts.thirdPartyHtml} third-party-html`);
  if (counts.legacyRoute > 0) parts.push(`${counts.legacyRoute} legacy-route`);
  if (counts.designSystemInternal > 0) {
    parts.push(`${counts.designSystemInternal} design-system-internal`);
  }
  if (counts.unclassified > 0) parts.push(`${counts.unclassified} unclassified`);
  const breakdown = parts.join(", ");
  return `Proposed ${total} baseline ${total === 1 ? "entry" : "entries"}: ${breakdown}. Review by category, then call \`baseline\` with mode: "create" to persist. Read unclassified entries first — the heuristic reasons (wrapper-undetected, third-party-html) are safer to batch.`;
}
