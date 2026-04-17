/**
 * MCP completions capability — `completion/complete` handler.
 *
 * The spec lets a server suggest argument values for prompts and
 * resource URIs. For ra11y this is the neat win:
 *
 *   - `ref/prompt` on `ra11y/vpat-narrative`, argument `criterionId`
 *     → every loaded criterion ID whose prefix matches `value`.
 *   - `ref/resource` on any `ra11y-kb://` URI → every KB resource
 *     URI whose path matches `value` (substring on the URI slug,
 *     since agents may partial-type the filename).
 *
 * Unknown refs — and refs we don't support completions for — return
 * the empty-completion shape, not an error. That's the spec's
 * contract (unknown ref is not an error) and it means a host that
 * blanket-asks for every argument doesn't see red boxes.
 *
 * Results are capped at COMPLETION_LIMIT so `hasMore` and `total`
 * stay honest when the KB grows large.
 */

import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { loadKbResources } from "./resources/index.ts";

/** Max values we return in one reply. Matches the spec's ceiling. */
const COMPLETION_LIMIT = 100;

export interface CompletionRef {
  readonly type: "ref/prompt" | "ref/resource" | string;
  /** `ref/prompt` variant — the prompt name. */
  readonly name?: string;
  /** `ref/resource` variant — the resource URI template/URI. */
  readonly uri?: string;
}

export interface CompletionArgument {
  readonly name: string;
  readonly value: string;
}

export interface CompletionResult {
  readonly completion: {
    readonly values: readonly string[];
    readonly hasMore: boolean;
    readonly total: number;
  };
}

/**
 * Build the empty-completion shape. Callers reach for this whenever
 * the ref/argument combination has no completion source — keeps
 * `{ values: [], hasMore: false, total: 0 }` identical everywhere.
 */
export function emptyCompletion(): CompletionResult {
  return { completion: { values: [], hasMore: false, total: 0 } };
}

/**
 * Dispatches the ref/argument pair to the appropriate source.
 * Unknown refs return empty-completion per spec. Callers validate
 * shape before calling this.
 *
 * KB resource completions require a filesystem walk, hence the
 * async hop. Prompt/criterion completions are pure data.
 */
export function complete(
  ref: CompletionRef,
  argument: CompletionArgument,
  cwd: string,
): Promise<CompletionResult> {
  if (ref.type === "ref/prompt") {
    return Promise.resolve(completePromptArgument(ref, argument));
  }
  if (ref.type === "ref/resource") {
    return completeResourceUri(ref, argument, cwd);
  }
  return Promise.resolve(emptyCompletion());
}

/**
 * Only `ra11y/vpat-narrative`'s `criterionId` argument has a typed
 * completion source today. Other prompts (triage, fix, audit) take
 * freeform text we cannot enumerate. Unrecognized prompt/arg pairs
 * return empty rather than erroring — same spec contract.
 */
function completePromptArgument(
  ref: CompletionRef,
  argument: CompletionArgument,
): CompletionResult {
  if (ref.name !== "ra11y/vpat-narrative") return emptyCompletion();
  if (argument.name !== "criterionId") return emptyCompletion();
  const prefix = argument.value ?? "";
  const all = collectCriterionIds();
  return filterAndCap(all, prefix);
}

/**
 * Completion source for the `ra11y-kb://` URI. The URI fragment an
 * agent partial-types is matched as a substring against the full
 * URI so both `wcag/1-4-3` and `1-4-3` find `ra11y-kb://wcag/1-4-3.md`.
 */
async function completeResourceUri(
  ref: CompletionRef,
  argument: CompletionArgument,
  cwd: string,
): Promise<CompletionResult> {
  // The host sends whichever URI it had in hand; we don't care about
  // the exact form here — completions run against the slug the user
  // is typing (`argument.value`). Guard against refs for non-ra11y
  // schemes by short-circuiting to empty.
  if (ref.uri !== undefined && !ref.uri.startsWith("ra11y-kb://")) {
    return emptyCompletion();
  }
  const resources = await loadKbResources(cwd);
  const uris = resources.map((r) => r.uri);
  const needle = argument.value ?? "";
  const matches = needle.length === 0 ? uris : uris.filter((u) => u.includes(needle));
  return {
    completion: {
      values: matches.slice(0, COMPLETION_LIMIT),
      hasMore: matches.length > COMPLETION_LIMIT,
      total: matches.length,
    },
  };
}

/**
 * Enumerates every criterion ID from every loaded standard. Stable-
 * sorted so completion ordering is deterministic across runs (agents
 * sometimes cache the first page).
 */
function collectCriterionIds(): readonly string[] {
  const ids: string[] = [];
  for (const standard of BUILTIN_STANDARDS) {
    for (const criterion of standard.criteria) {
      ids.push(criterion.id);
    }
  }
  ids.sort();
  return ids;
}

/**
 * Prefix-filter + cap. Prefix match (not substring) because
 * criterion IDs read left-to-right — an agent typing `wcag22:1.4`
 * wants the `1.4.x` family, not every criterion that mentions `4`.
 */
function filterAndCap(all: readonly string[], prefix: string): CompletionResult {
  const matches = prefix.length === 0 ? all : all.filter((id) => id.startsWith(prefix));
  return {
    completion: {
      values: matches.slice(0, COMPLETION_LIMIT),
      hasMore: matches.length > COMPLETION_LIMIT,
      total: matches.length,
    },
  };
}
