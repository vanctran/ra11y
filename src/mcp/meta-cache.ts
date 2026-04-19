/**
 * MCP session meta-cache — `sessionRef` + delta emission for tight
 * tool-call loops.
 *
 * Default behavior is unchanged: every scan response carries its full
 * `meta` block. Callers that want to shrink repeat-call bloat (the
 * scan → fix → rescan loop canonically emits 90% identical
 * `configSource` / `configSearchedFrom` / `rulesEvaluated` /
 * `filesByExtension` / wrapper telemetry) opt in by passing
 * `metaMode: "delta"`.
 *
 * When delta mode is engaged:
 *
 *   - First call with a given input signature: response carries the
 *     full `meta` block plus a `sessionRef` (stable 8-hex-char hash of
 *     toolName + normalized inputs). The response is ALSO stamped with
 *     `metaMode: "full"` so the agent knows this baseline is the
 *     reference for subsequent deltas.
 *   - Repeat call with the same signature: response's `meta` collapses
 *     to `{ sessionRef, metaMode: "delta", delta: {...}, removedFields:
 *     [...] }`. Unchanged fields are implicit by absence; the agent
 *     merges `delta` over its cached baseline keyed by `sessionRef`.
 *
 * The `metaMode` output field is the load-bearing shape signal — a
 * caller can never misread an empty delta as "the tool never ran" (see
 * CLAUDE.md §1 "Zero-output success is ambiguous failure"). The field
 * is absent entirely when the caller did not opt in, keeping legacy
 * response shapes identical.
 *
 * Cache eviction is per-signature replacement: when any input the hash
 * covers changes (cwd, additionalPaths, standard, level, etc.), a new
 * `sessionRef` is issued and the prior entry for that tool's key is
 * dropped. The cache never grows unbounded for a stable signature;
 * cross-signature entries accumulate for the life of the session.
 */

import type { McpSession } from "./session.ts";

/**
 * Shape of the delta-mode `meta` block. Emitted when a repeat call
 * with `metaMode: "delta"` matches a cached baseline signature.
 *
 * `delta` only includes fields whose JSON-equal values differ from the
 * baseline. `removedFields` names fields present in the baseline but
 * absent in the current meta (the baseline's value is invalidated —
 * the agent must drop its cached entry for those keys). Unchanged
 * fields are implicit: absent from both `delta` and `removedFields`
 * means "use the baseline value."
 *
 * `removedFields` is only included when at least one field disappeared;
 * an empty array would read as data (CLAUDE.md §1 "Ambiguous field
 * shapes are dishonest").
 */
export interface DeltaMeta {
  readonly sessionRef: string;
  readonly metaMode: "delta";
  readonly delta: Record<string, unknown>;
  readonly removedFields?: readonly string[];
}

/**
 * Shape of the full-mode `meta` block when delta mode is opted in but
 * the session has no cached baseline yet. Adds `sessionRef` +
 * `metaMode: "full"` alongside all the canonical meta fields.
 */
export type FullMeta = Record<string, unknown> & {
  readonly sessionRef: string;
  readonly metaMode: "full";
};

/**
 * Reads the `metaMode` flag off the tool's raw param record. Returns
 * `"delta"` or `"full"`; any other value (including `undefined`) is
 * coerced to `"full"` so legacy callers and malformed inputs share
 * the same default.
 */
export function readMetaMode(params: Record<string, unknown>): "full" | "delta" {
  const raw = params["metaMode"];
  return raw === "delta" ? "delta" : "full";
}

/**
 * JSON-Schema fragment shared across every scan-family tool's
 * `inputSchema.properties`. The wording points at both the opt-in
 * default and the mechanics — callers that want the flag to actually
 * reduce bloat must pass the same signature-relevant inputs on repeat
 * calls and keep passing `metaMode: "delta"`.
 */
export const metaModeSchema = {
  type: "string",
  enum: ["full", "delta"],
  description:
    'Opt-in meta-cache mode for tight tool-call loops. Default `"full"` (legacy behavior): every response carries the complete `meta` block. Pass `"delta"` on both the first and subsequent calls to enable the cache — the first response still carries the full `meta` plus `meta.sessionRef` + `meta.metaMode: "full"` so you have a baseline; repeat calls with identical inputs collapse `meta` to `{ sessionRef, metaMode: "delta", delta, removedFields? }`. Merge `delta` over your cached baseline keyed by `sessionRef`; fields named in `removedFields` are no longer applicable. Any input change (cwd, paths, standard, level, etc.) issues a fresh `sessionRef` and ships full `meta` again.',
} as const;

/**
 * Hash input parameters into an 8-hex-char signature for the cache
 * key. Stable across equal inputs (sorted-keys JSON), and covers
 * everything that could legitimately change scan output:
 * - tool name
 * - cwd / paths / path
 * - standard / level / minSeverity
 * - additionalPaths / changedOnly / since
 * - verboseMeta / includeRuleDetails / skipCriterion
 * - autoDetectWrappers
 *
 * Deliberately excludes `metaMode` itself and pagination fields
 * (`limit`, `offset`) so a paged walk through the same scan stays on
 * one sessionRef. Fields we don't list are excluded from the hash —
 * the goal is "same scan output → same sessionRef" rather than
 * "bit-exact param match."
 */
const SIGNATURE_FIELDS = [
  "cwd",
  "path",
  "paths",
  "standard",
  "level",
  "minSeverity",
  "changedOnly",
  "since",
  "additionalPaths",
  "autoDetectWrappers",
  "verboseMeta",
  "skipCriterion",
  "includeRuleDetails",
  "hunksOnly",
  "comparisonRef",
  "baselinePath",
] as const;

export function hashToolInput(toolName: string, params: Record<string, unknown>): string {
  // Canonical JSON over a sorted, filtered slice — same inputs always
  // serialize to the same bytes regardless of caller ordering.
  const payload: Record<string, unknown> = { tool: toolName };
  for (const field of SIGNATURE_FIELDS) {
    if (field in params && params[field] !== undefined) {
      payload[field] = normalize(params[field]);
    }
  }
  const serialized = canonicalStringify(payload);
  const digest = fnv1a32(serialized);
  // 8 hex chars → 4B of collision surface. That's ample for a
  // per-session Map keyed on stable-input tuples; a collision would
  // mean two different inputs produce the same hash within one
  // process lifetime (thousands of tool calls on a long session at
  // most), which is numerically improbable and — if it did happen —
  // would at worst serve a stale delta to the agent, which merges the
  // baseline by `sessionRef` and would see inconsistent fields. Safe
  // shape: any hash collision degrades to an agent refetch, never a
  // silent wrong answer.
  return `${toolName}-${digest.toString(16).padStart(8, "0")}`;
}

/**
 * Normalizes sub-values for canonical hashing: arrays sort, objects
 * sort keys, primitives pass through. Stable across caller ordering so
 * `exclude: ["a", "b"]` and `exclude: ["b", "a"]` hash identically.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(normalize);
    // Only sort arrays of primitives — sorting object arrays would
    // mangle order-sensitive payloads (e.g., rules catalog responses
    // treat order as stable). For the signature-fields set listed
    // above, every array value is a string list (paths, criterion
    // IDs, rule IDs), so sorting is correct.
    return normalized.every((v) => v === null || typeof v !== "object")
      ? [...normalized].sort()
      : normalized;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) out[k] = normalize(obj[k]);
    return out;
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * FNV-1a 32-bit hash. Zero-dep, deterministic, fast. Not a
 * cryptographic hash — we don't need one; the only attack vector is
 * "make two inputs collide and serve a stale delta," which degrades
 * to agent refetch, not silent wrong-answer (the `sessionRef` itself
 * is derived from the hash, so a collision shows up as
 * same-sessionRef-different-semantics and the agent's merge would
 * detect it on the next differing field).
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime; >>> 0 keeps hash as an unsigned 32-bit int.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Compute the delta between the cached baseline meta and the current
 * meta. A field is in `delta` when its value changed (by JSON
 * equality); a field is in `removedFields` when it was present in the
 * baseline but absent in the current meta.
 *
 * Fields present in `curr` but not in `baseline` naturally land in
 * `delta` (the agent learns the new value). Fields unchanged in both
 * are absent from both sides — the agent keeps its cached baseline
 * value.
 */
export function computeMetaDelta(
  baseline: Record<string, unknown>,
  curr: Record<string, unknown>,
): { readonly delta: Record<string, unknown>; readonly removedFields: readonly string[] } {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(curr)) {
    if (!jsonEqual(value, baseline[key])) {
      delta[key] = value;
    }
  }
  const removedFields: string[] = [];
  for (const key of Object.keys(baseline)) {
    if (!(key in curr)) removedFields.push(key);
  }
  return { delta, removedFields };
}

/**
 * Deep JSON equality — arrays compared positionally, objects by key
 * set + per-key recursion. Cycles aren't possible in `meta` (pure
 * data assembled from scanner output), so the recursion is bounded.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) return Array.isArray(b) && arraysEqual(a, b);
  if (typeof a === "object")
    return objectsEqual(a as Record<string, unknown>, b as Record<string, unknown>);
  return false;
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!jsonEqual(a[i], b[i])) return false;
  return true;
}

function objectsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) if (!jsonEqual(a[k], b[k])) return false;
  return true;
}

/**
 * The response-assembly entry point. Given the tool name, the caller's
 * params, the fully-assembled `meta` block the handler would have
 * shipped by default, and the session, return the `meta` object to
 * actually emit.
 *
 * In `"full"` mode this is a pass-through — legacy behavior is
 * preserved exactly, no sessionRef is added, no cache entry is
 * written.
 *
 * In `"delta"` mode:
 *   - No prior cache entry for this signature → write one, return
 *     `{ ...fullMeta, sessionRef, metaMode: "full" }`.
 *   - Matching cache entry → compute delta, return
 *     `{ sessionRef, metaMode: "delta", delta, removedFields? }`.
 *     Replace the cache entry with the current meta so the next call's
 *     delta is against the latest state (drift-free baseline).
 */
export function applyMetaCacheMode(args: {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
  readonly fullMeta: Record<string, unknown>;
  readonly session: McpSession;
}): Record<string, unknown> {
  const mode = readMetaMode(args.params);
  if (mode === "full") return args.fullMeta;

  const sessionRef = hashToolInput(args.toolName, args.params);
  const baseline = args.session.getCachedMeta(sessionRef);

  if (baseline === undefined) {
    // First call under this signature — store full meta as baseline,
    // emit full meta + sessionRef marker.
    args.session.putCachedMeta(sessionRef, args.fullMeta);
    return { ...args.fullMeta, sessionRef, metaMode: "full" };
  }

  const { delta, removedFields } = computeMetaDelta(baseline, args.fullMeta);
  // Replace the baseline with the current meta so future deltas are
  // against the latest state. Without this, a field that flapped
  // (e.g., `durationMs`) would accumulate in the agent's view against
  // the very first baseline, never picking up legitimate intermediate
  // changes to neighboring fields.
  args.session.putCachedMeta(sessionRef, args.fullMeta);
  const out: Record<string, unknown> = {
    sessionRef,
    metaMode: "delta",
    delta,
    ...(removedFields.length > 0 ? { removedFields } : {}),
  };
  return out;
}
