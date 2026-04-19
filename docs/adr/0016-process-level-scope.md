# 0016 — Process-level scope

- Status: Proposed
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

Three WCAG criteria cannot be evaluated on a single page in isolation:

- **3.2.3 Consistent navigation** — navigation mechanisms that appear on
  multiple pages in a set must appear in the same relative order each time
  they are repeated.
- **3.2.4 Consistent identification** — components that have the same
  functionality across a set of pages must be identified consistently.
- **2.4.5 Multiple ways** — more than one way must be available to locate a
  page within a set of pages (site map, search, links between pages, etc.)
  except where the page is the result of, or a step in, a process.

Today ra11y evaluates these via heuristic route-discovery in
`src/review/finders/consistent-navigation.ts`. The heuristic infers a "set
of pages" from file-path patterns (e.g. `src/pages/**/*.tsx`). This produces
approximate candidates with uncertain blast radius — two pages may or may not
be part of the same user journey, and the heuristic has no way to distinguish.

The result is review candidates tagged with weak `reason` text ("navigation
elements detected across multiple pages — verify consistency") that agents
must re-investigate from scratch. A deterministic page-set declaration would
let ra11y produce precise candidates ("the `<nav>` order differs between
`/checkout/cart.tsx` and `/checkout/confirm.tsx`") and refuse to emit a
conformance statement when the criterion has no page-set to check.

The conformance capstone (Track C v1.0) makes this concrete: a profile
claiming WCAG 2.2 AA cannot emit a conformance statement if 3.2.3, 3.2.4, and
2.4.5 have no deterministic evidence source.

## Decision

**Add a `processes` config primitive to `ra11y.config.ts`. Each process is a
named ordered list of page file paths. Process-level criteria run across the
full page set. Deterministic config wins over heuristic discovery.**

### Config shape

```ts
// ra11y.config.ts
export default defineConfig({
  processes: [
    {
      name: "checkout",
      pages: [
        "src/pages/checkout/cart.tsx",
        "src/pages/checkout/shipping.tsx",
        "src/pages/checkout/payment.tsx",
        "src/pages/checkout/confirm.tsx",
      ],
    },
    {
      name: "account",
      pages: [
        "src/pages/account/profile.tsx",
        "src/pages/account/security.tsx",
      ],
    },
  ],
});
```

TypeScript type in `src/config/schema.ts`:

```ts
interface ProcessConfig {
  readonly name: string;
  readonly pages: readonly string[];  // file paths; order is explicit
}
```

Pages are file paths relative to the config file's directory (same resolution
rule as `include`/`exclude` globs). URL patterns for runtime-ingest cases are
out of scope for this ADR; the `pages` field is typed `string[]` so URL
strings can be added later without a breaking change.

**Page ordering is explicit.** ra11y does not infer order from file names,
directory structure, or import graphs. The caller specifies order. This matches
the "deterministic evidence beats inference" doctrine and avoids the
heuristic-ordering failure mode (alphabetical order is not navigation order).

### Which criteria are process-level

| Criterion | Level | Evaluation scope |
|-----------|-------|-----------------|
| 3.2.3 Consistent navigation | AA | Process-level — compares nav across ordered page set |
| 3.2.4 Consistent identification | AA | Process-level — compares component labels across page set |
| 2.4.5 Multiple ways | AA | Process-level — checks existence of site map / search / cross-links across page set |
| Everything else | — | Page-level — unchanged |

The process scope does not affect page-level criteria. Running `scan_process`
does not suppress page-level findings; it adds process-level results on top.

### `scan_process` tool — input/output

**Input:**

```ts
{
  processName?: string;  // omit to run all processes in config
  cwd?: string;          // defaults to MCP server's cwd
}
```

When `processName` is omitted and the config defines multiple processes,
`scan_process` runs all of them and returns an array of
`ProcessScanResult`.

**Output per process:**

```ts
interface ProcessScanResult {
  processName: string;
  pagesScanned: number;
  pageOrder: string[];   // file paths in the order the config specified
  perCriterionResults: ProcessCriterionResult[];
  reviewCandidates: ReviewCandidate[];
  meta: {
    configSource: string;
    processConfigPresent: true;
    rulesEvaluated: string[];
  };
  warnings?: string[];   // e.g. "page_not_found" when a config path is missing
}

interface ProcessCriterionResult {
  criterionId: string;
  verdict: "pass" | "fail" | "manual" | "absent";
  // "absent" = criterion requires process config but none was found
  // (only returned when scan_process is called without a processes config
  //  — should not happen in normal usage but must be honest)
  findings: ProcessFinding[];
}

interface ProcessFinding {
  pageA: string;   // file path
  pageB: string;   // file path (the differing counterpart)
  ruleId: string;
  message: string;
  severity: "error" | "warning";
}
```

`reviewCandidates` on the process result uses the same `ReviewCandidate`
shape as `scan_project`, so agent consumption code is uniform.

When `processName` is provided but not found in config, the tool returns a
structured error (`process_not_found`) rather than an empty result — per the
AI-first doctrine on zero-output ambiguity.

When `processes` is absent from the config and `scan_process` is called, the
tool returns `verdict: "absent"` for each process-level criterion and emits
a `no_process_config` warning. This is honest failure: the agent knows the
criterion cannot be evaluated, rather than receiving a clean result.

### Interaction with `consistent-navigation.ts` finder

The existing heuristic finder in
`src/review/finders/consistent-navigation.ts` infers page sets from file-path
patterns. With `processes` config present, this logic is bypassed:

1. `scan_process` calls process-aware finders directly with the explicit
   page list.
2. `scan_project` continues calling the heuristic finder, but when `processes`
   config is present it passes the process page lists as hints. The heuristic
   then constrains its candidates to those page sets rather than scanning
   the entire file tree. The heuristic does not fire for pages not in any
   process config — those pages produce no 3.2.3/3.2.4/2.4.5 candidates
   from `scan_project`, only from `scan_process`.
3. When `processes` is absent, the heuristic finder behaves exactly as today
   (backward compatible).

The priority order — deterministic config over heuristic — matches CLAUDE.md's
"deterministic evidence beats inference" principle and mirrors the
`consistent-navigation.ts` upgrade planned in the implementation track.

New finder `src/review/finders/consistent-identification.ts` (3.2.4) is
process-aware from the start: it only runs when a process config is present,
comparing button/link labels and aria-labels across the ordered page set.
Divergent labels for the same semantic action surface as review candidates
with the diverging pages and label text in the `reason`.

### Relationship to profiles

A conformance profile (Track C v1.0) that claims WCAG 2.2 AA must cover
3.2.3, 3.2.4, and 2.4.5. The conformance-statement generator will:

1. Check whether a `processes` config exists with at least one process.
2. If not, refuse to emit a conformance statement for profiles that include
   any process-level criterion. The refusal is a structured error
   (`missing_process_config`) citing the criterion IDs that cannot be
   verified, not a silent partial statement.
3. If yes, run `scan_process` as part of the statement evidence bundle.

This refusal is intentional: a conformance statement without process-level
evidence for process-level criteria is a dishonest claim, not a degraded
partial claim.

### Page-not-found handling

If a path in `pages` does not resolve to a parseable file at scan time, the
tool emits a `page_not_found` warning citing the path and continues with the
remaining pages. It does not abort. The per-criterion verdict for that process
is `manual` (not `pass`) so the conformance statement generator does not
treat missing pages as clean.

## Consequences

**Accepted:**

- `ProcessConfig` interface added to `src/config/schema.ts`; `defineConfig`
  accepts an optional `processes` field.
- `src/config/validate.ts` validates process config: each `name` is unique,
  each `pages` entry is a non-empty string, duplicate pages within a process
  are a validation warning (not error).
- New MCP tool `scan_process` surfaces process-level criterion results.
- `src/review/finders/consistent-navigation.ts` gains a process-aware path;
  heuristic remains as fallback.
- New `src/review/finders/consistent-identification.ts` for 3.2.4.
- `src/reports/coverage.ts` marks 3.2.3, 3.2.4, and 2.4.5 as `absent` when
  no process config is present (previously: `manual` with no further signal).
- The conformance-statement ADR (Track C v1.0) inherits this ADR's refusal
  semantics.

**Rejected alternatives:**

- **Infer page order from directory structure or file-name prefixes.** Rejected
  — alphabetical or depth-first order is not navigation order. Inference
  would be a heuristic, and a wrong order produces wrong consistency results.
  Explicit is the only honest option.
- **URL patterns for `pages` (runtime-ingest scope).** Deferred — URL-pattern
  matching requires a running server. Out of scope for the static-analysis
  track; runtime-ingest cases (ADR 0015) will extend the `pages` field later.
- **`scan_project` automatically running process checks when config is
  present.** Rejected — `scan_project` is already scoped to per-file static
  analysis. Mixing page-level and process-level results in one response
  conflates two evaluation modes and inflates the `totalFindings` counter
  with a categorically different finding type. Separate tools, separate
  counters.
- **Emit `verdict: "manual"` (not `"absent"`) when process config is
  missing.** Rejected — `manual` implies human review is the path forward.
  `absent` is more precise: the criterion cannot be evaluated at all without
  the config primitive. Agents deserve the distinction.
- **Silent partial conformance statement when process config is absent.**
  Rejected — dishonest claim is worse than honest refusal. The conformance
  statement generator must refuse explicitly.

## Open questions

1. **Process-level runtime evidence.** When an agent runs axe across a process
   (multi-page Playwright run), should `ingest_runtime_results` (ADR 0015)
   accept a `processName` to scope results? The `RuntimeResult` shape has no
   process field today. Deferred to ADR 0015's follow-up open question 3.
2. **Cross-process page membership.** Should a page be allowed to appear in
   more than one process? No restriction is proposed here — the schema does
   not enforce uniqueness across processes. An agent may want the same
   checkout confirmation page in both a "checkout" and a "guest-checkout"
   process. Open until a concrete need arises.
3. **Process-level attestation scope.** ADR 0013's attestation model keys on
   `(criterionId, scope: { path | process })`. The `process` scope variant
   is stubbed but not fully specified. Process-level attestation semantics
   (e.g. an agent attesting 3.2.3 for the "checkout" process) are deferred
   to the attestation implementation track.
4. **`multiple-ways` finder implementation.** 2.4.5 requires detecting
   whether multiple navigation paths exist to a page — site map presence,
   search presence, and inbound links. The review candidate logic for this
   criterion at process level is non-trivial; `consistent-identification.ts`
   is the first finder to land; 2.4.5 is deferred to a follow-up
   implementation item.

## References

- [ADR 0005](./0005-in-house-mcp-server.md) — MCP server shape; `scan_process`
  follows the same tool-response discipline.
- [ADR 0013](./0013-rule-scoped-attestations.md) — attestation scope model
  that process-level attestations will extend.
- [ADR 0015](./0015-runtime-evidence-ingest.md) — runtime ingest; open
  question 3 is the cross-ADR dependency.
- [`docs/kb/architecture/ai-first-consumer.md`](../kb/architecture/ai-first-consumer.md)
  — doctrine cited for honest-failure vs silent-partial, and for keeping
  scan_project and scan_process as separate surfaces.
- WCAG 2.2 §3.2.3 Consistent navigation:
  https://www.w3.org/TR/WCAG22/#consistent-navigation
- WCAG 2.2 §3.2.4 Consistent identification:
  https://www.w3.org/TR/WCAG22/#consistent-identification
- WCAG 2.2 §2.4.5 Multiple ways:
  https://www.w3.org/TR/WCAG22/#multiple-ways
