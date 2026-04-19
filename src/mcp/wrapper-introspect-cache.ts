/**
 * Per-session cache for `wrapper_introspect` records.
 *
 * ADR 0012 — introspection results are cached for the duration of the
 * MCP session, keyed by `sha256(filePath + fileContents)` truncated to
 * 16 hex chars. Natural invalidation via hash mismatch when contents
 * change; no time-based eviction; in-memory only.
 *
 * The cache is keyed by `McpSession` so two concurrent connections
 * don't leak entries across each other (the MCP server is
 * single-session today, but the discipline is cheap and the invariant
 * survives multi-session rewiring). `WeakMap` lets the cache entries
 * go when the session is reclaimed — no manual teardown needed.
 *
 * Keeping the store in a dedicated module (rather than a new field on
 * `McpSession`) matches the pattern the rest of `src/mcp/` follows:
 * tools that need local memo state own it, and the session stays the
 * thin shared state holder. Swapping to a Session field is a one-line
 * change later if another tool wants to piggyback on the cache.
 */

import { createHash } from "node:crypto";
import type { McpSession } from "./session.ts";

/** Hash length (hex chars) stored as the cache key — matches the ADR. */
const CACHE_KEY_LENGTH = 16;

/** Shape stored per introspected wrapper. Immutable, one record per key. */
export interface CachedIntrospectionRecord {
  readonly name: string;
  readonly definitionFile: string | null;
  readonly observedRoot: "button" | "a" | "input" | "div" | "opaque" | "unknown";
  readonly confidence: "confirmed" | "assumed" | "unresolved";
}

/**
 * Per-session mapping: content-hash → introspection record. Distinct
 * names that resolve to the same file share one entry by hash (the
 * record itself carries the name so agents don't have to look the
 * name up elsewhere).
 */
type SessionCache = Map<string, CachedIntrospectionRecord>;

/**
 * WeakMap so a dropped session's entries get reclaimed without manual
 * cleanup. Exported (via the helpers below) only for observability in
 * tests — production callers go through `getOrCompute`.
 */
const CACHES: WeakMap<McpSession, SessionCache> = new WeakMap();

function cacheFor(session: McpSession): SessionCache {
  let c = CACHES.get(session);
  if (c === undefined) {
    c = new Map();
    CACHES.set(session, c);
  }
  return c;
}

/**
 * Computes the deterministic cache key for a file's current contents.
 * Exported so call sites can probe-before-compute if they want to
 * measure hit rates; most callers just use `getOrCompute`.
 */
export function wrapperIntrospectCacheKey(filePath: string, source: string): string {
  return createHash("sha256")
    .update(filePath)
    .update("\0")
    .update(source)
    .digest("hex")
    .slice(0, CACHE_KEY_LENGTH);
}

/**
 * Returns the cached record for `(filePath, source)` or invokes
 * `compute` and stores the result. Sync `compute` keeps the call site
 * a pure function over already-parsed AST state — the probe itself
 * does no IO.
 */
export function getOrCompute(
  session: McpSession,
  filePath: string,
  source: string,
  compute: () => CachedIntrospectionRecord,
): { readonly record: CachedIntrospectionRecord; readonly cacheHit: boolean } {
  const key = wrapperIntrospectCacheKey(filePath, source);
  const cache = cacheFor(session);
  const existing = cache.get(key);
  if (existing !== undefined) return { record: existing, cacheHit: true };
  const record = compute();
  cache.set(key, record);
  return { record, cacheHit: false };
}

/** Number of cached entries for a session — diagnostics only. */
export function wrapperIntrospectCacheSize(session: McpSession): number {
  return cacheFor(session).size;
}

/**
 * Wipes the cache for a session. Not wired from any production path —
 * exported so tests can exercise miss paths deterministically without
 * constructing a fresh session.
 */
export function clearWrapperIntrospectCache(session: McpSession): void {
  cacheFor(session).clear();
}
