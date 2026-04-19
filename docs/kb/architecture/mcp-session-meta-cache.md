---
title: "MCP session meta cache"
topic: architecture
audience: agents, contributors
summary: "Opt-in metaMode:delta primitive that collapses repeated scan-family meta blocks to a sessionRef + delta diff, eliminating ~30% bloat in tight scan→fix→rescan loops while preserving legacy full-meta shapes."
---

# MCP session meta cache

In a tight scan → fix → rescan loop, every tool response carries the same `meta` block: `configSource`, `configSearchedFrom`, `rulesEvaluated`, `filesByExtension`, wrapper telemetry. The values rarely change between calls. On large codebases this bloat accounts for roughly 30% of the response payload and is pure noise to the agent after the first call.

The meta cache solves this without trimming `meta` (which would violate the "verbose meta is signal, not clutter" doctrine) — instead it keeps `meta` intact by default and offers an explicit opt-in to collapse repeat calls to a diff.

## Shape

The primitive is controlled by the `metaMode` input field on every scan-family tool (`scan_project`, `scan`, `scan_file`, `scan_diff`). Two output shapes exist:

**Full meta — first call in delta mode, or legacy mode**

```json
{
  "meta": {
    "configSource": "ra11y.config.ts",
    "configSearchedFrom": "/repo",
    "rulesEvaluated": 47,
    "filesByExtension": { ".tsx": 12, ".html": 3 },
    "activeNativeWrappers": ["Button", "Link"],
    "sessionRef": "scan_project-3a1b2c4d",
    "metaMode": "full"
  }
}
```

**Delta meta — repeat call with same signature in delta mode**

```json
{
  "meta": {
    "sessionRef": "scan_project-3a1b2c4d",
    "metaMode": "delta",
    "delta": {
      "durationMs": 42
    },
    "removedFields": ["autoDetectedWrappers"]
  }
}
```

Key rules on the delta shape:

- Fields absent from both `delta` and `removedFields` are unchanged — the agent merges `delta` over its cached baseline keyed by `sessionRef`.
- `removedFields` is omitted entirely when no fields disappeared (not emitted as `[]`; that would violate the "ambiguous field shapes are dishonest" doctrine — an empty array reads as data).
- `metaMode` is absent entirely in legacy (full-pass-through) mode — the response is indistinguishable from responses before the cache existed.

TypeScript interfaces (from `src/mcp/meta-cache.ts`):

```ts
interface DeltaMeta {
  readonly sessionRef: string;
  readonly metaMode: "delta";
  readonly delta: Record<string, unknown>;
  readonly removedFields?: readonly string[];
}

type FullMeta = Record<string, unknown> & {
  readonly sessionRef: string;
  readonly metaMode: "full";
};
```

## Semantics

### Opt-in only

Legacy callers pass no `metaMode` (or `metaMode: "full"`). `readMetaMode` coerces anything other than the string `"delta"` to `"full"`. The response is `fullMeta` passed through untouched — no `sessionRef`, no cache write, no behavior change.

### First call in delta mode

`hashToolInput(toolName, params)` derives a stable `sessionRef` — `"<toolName>-<8hexchars>"` — from the inputs that could legitimately change scan output:

```
cwd, path, paths, standard, level, minSeverity,
changedOnly, since, additionalPaths, autoDetectWrappers,
verboseMeta, skipCriterion, includeRuleDetails, hunksOnly,
comparisonRef, baselinePath
```

`metaMode` itself is excluded (toggling full↔delta doesn't change the scan), as are pagination fields (`limit`, `offset`) so a paged walk through the same scan stays on one `sessionRef`.

No cache entry exists for this signature, so `applyMetaCacheMode` stores the full meta as the baseline and returns `{ ...fullMeta, sessionRef, metaMode: "full" }`.

### Repeat call in delta mode

`session.getCachedMeta(sessionRef)` finds the baseline. `computeMetaDelta(baseline, curr)` returns:

- `delta` — fields whose JSON-equal values differ (including new fields absent from the baseline).
- `removedFields` — fields present in the baseline but absent in `curr`.

The baseline in the session is **replaced** with `curr` on every call. Without replacement, a field that changed and then stabilized would keep appearing in `delta` against the original; after replacement, the next call's delta is against the latest state.

### Signature change

Any change to the covered input fields (different `cwd`, different `standard`, etc.) produces a new `sessionRef`. The old entry stays in the session's cache — cross-signature entries accumulate for the lifetime of the connection. The new signature gets a fresh first call (full meta + new `sessionRef`).

### Hash collision

The 8-hex-char space is 4 billion values. A collision within a single session would mean two different input tuples hash to the same `sessionRef`. The failure mode is an agent receiving a stale delta — the merge produces inconsistent fields on the fields that changed — not a silent wrong answer. The agent reads unexpected field values and can request a fresh `sessionRef` by sending the same call without `metaMode: "delta"`. This failure mode is numerically improbable on typical session sizes.

## Assembly entry point

Tool handlers call `applyMetaCacheMode` at response-assembly time:

```ts
import { applyMetaCacheMode } from "../meta-cache.ts";

// Inside a tool handler:
const rawMeta = buildFullMeta(scanResult, session, params);
const meta = applyMetaCacheMode({
  toolName: "scan_project",
  params: rawParams,
  fullMeta: rawMeta,
  session,
});
return { ...findings, meta };
```

`applyMetaCacheMode` is a pure function over its arguments and the session's `getCachedMeta` / `putCachedMeta` state. No other module-level state.

## Doctrinal anchors

Three rules from [`ai-first-consumer.md`](./ai-first-consumer.md) are load-bearing here:

- **"Verbose meta is signal, not clutter."** The cache does not suppress `meta`. `metaMode: "full"` (the default) preserves every existing field with no changes to the shape.
- **"Ambiguous field shapes are dishonest."** `removedFields: []` would look like data. The field is conditionally spread: `...(removedFields.length > 0 ? { removedFields } : {})`. Same rule: `metaMode` is absent in full-pass-through mode so legacy consumers never see it.
- **"Zero-output success is ambiguous failure."** `metaMode: "full"` on the first delta-mode call ensures the agent has a concrete baseline before any delta can be computed. An agent cannot misread an empty `delta` as "the tool never ran" because the first call always carries the full block.

## When NOT to rely on it

- **First call is always full meta.** An agent that checks `meta.metaMode === "delta"` on the first call will see `"full"` and must handle that as the baseline, not as an error or cache miss.
- **Scope is per-tool, per-signature.** A `scan_project` `sessionRef` is not shared with `scan_file`. Change any signature field — even `level` — and you get a new `sessionRef`.
- **Absence of `sessionRef` means delta mode was not requested.** Treat it as full meta, not as a failed cache lookup.
- **Bounded by session lifetime.** The cache lives in `McpSession` and is discarded when the connection closes. Re-connecting always starts fresh.
- **Agent C's tool additions do not change this architecture.** The cache is wired per-tool at the `applyMetaCacheMode` call site; adding more tools that call it extends coverage without touching the cache semantics.

## Cross-references

- [`src/mcp/meta-cache.ts`](../../../src/mcp/meta-cache.ts) — `hashToolInput`, `computeMetaDelta`, `applyMetaCacheMode`, `DeltaMeta`, `FullMeta`, `metaModeSchema`.
- [`src/mcp/session.ts`](../../../src/mcp/session.ts) — `getCachedMeta`, `putCachedMeta`, `metaCacheSize`.
- [`tests/unit/mcp/meta-cache.test.ts`](../../../tests/unit/mcp/meta-cache.test.ts) — unit coverage for all three invariants.
- [`tests/integration/mcp-meta-cache.test.ts`](../../../tests/integration/mcp-meta-cache.test.ts) — end-to-end subprocess round-trip coverage.
- [`mcp-server.md`](./mcp-server.md) — overall server shape and session lifecycle.
- [`ai-first-consumer.md`](./ai-first-consumer.md) — doctrine for the shape decisions above.
