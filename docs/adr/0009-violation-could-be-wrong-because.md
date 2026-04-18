# 9. Violation.couldBeWrongBecause — structured reason codes for informational caveat

Date: 2026-04-17
Status: Accepted

## Context

Several rules in the registry fire on signals that have well-known, named
escape hatches — patterns that, when present in surrounding code, lower the
*probability* that the finding is actionable without actually satisfying the
spec. Canonical cases:

- `forms/required-indicator-missing` fires on a wrapper that forwards `required`
  with no visible marker. If a **sibling file** exports a styled asterisk
  component the wrapper's consumers pass in, the wrapper itself is fine and
  the violation is spurious. Reason code: `replacement_indicator_in_sibling_file`.
- A contrast rule that fires on a CSS declaration might be undermined by a
  Tailwind utility class applied at the consumer site that overrides the
  declared color. Reason code: `tailwind_class_on_consumer`.

Agents can investigate these escape hatches cheaply (one `Read` or `Grep`), but
only if the finding tells them *which* escape hatch to look for. Today the
`reason`-text prose conflates "here's why the rule fired" with "here's where
it could be wrong"; the latter is load-bearing triage context and deserves a
structured, stable shape.

## Decision

Every `Violation` carries a new optional field:

```ts
readonly couldBeWrongBecause?: readonly string[];
```

Each entry is a **named reason code** — lowercase, snake_case, stable across
releases — describing one known escape hatch the finding is vulnerable to.
Codes are additive (a finding can carry several); absence means the rule has
no known escape hatches for this case.

### Rules ARE the authors of codes

Per ADR 0007 / 0008 precedent (`fixClass`, `groupKey`): rules that know their
own false-positive axes populate the field at `ctx.emit()` time. The engine
does not compute or synthesize codes. Rules that have no known escape hatches
simply omit the field.

This commit lands the **shape + forwarders only** — no rule populates the
field yet. Per-rule opt-in is separate backlog work.

### Informational, never auto-suppressing

Per AI-first consumer doctrine (docs/kb/architecture/ai-first-consumer.md §
"No heuristic suppression, even for spec carve-outs"): the presence of a
reason code does **not** cause the tool to drop, downgrade, or bucket the
finding. The codes are signal the agent uses to investigate; the agent reads
the cited file and decides. The scanner's attribute-level evidence is
categorically weaker than the agent's file-level evidence — bake inference
into the tool and the silent-miss mode the doctrine exists to prevent
reappears.

Corollary: `estimatedFpRate: number` was considered and rejected (backlog
"Considered and rejected", round 2 retriage). Any consumer filtering on
`fp_rate > X` reintroduces numeric-threshold suppression. Reason codes carry
the same information without the threshold.

### Shape hygiene

- **Present-when-meaningful.** Omit the field entirely when empty. Never emit
  `couldBeWrongBecause: []`. Conditional spread at every forwarding site:
  ```ts
  ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
    ? { couldBeWrongBecause: v.couldBeWrongBecause }
    : {})
  ```
  Per CLAUDE.md §1 "Ambiguous field shapes are dishonest" — consumers cannot
  distinguish empty-array-because-no-hazards from empty-array-because-the-
  field-wasn't-populated-yet.

- **Strings, not enums, at the type level.** A union literal would force every
  rule-author commit to touch a shared enum and every consumer to handle new
  codes as type errors. Rules ship codes as strings; rule authors grep the
  repo for precedent before minting a new code; the set is self-documented by
  usage. This is the same trade-off standard identifiers, criterion IDs, and
  fix-class values already make (though `FixClass` kept its union because the
  set is tightly bounded — reason codes are open-ended).

- **readonly string[].** Immutable, ordered. Order carries no semantics but is
  preserved across the engine → formatter → MCP boundary for deterministic
  output.

### Forwarding

Two formatter paths surface findings to agents:

1. `buildAgentFinding` in `src/output/agent-response/build-finding.ts` —
   the single Violation→AgentFinding builder. Every MCP tool response
   that embeds findings (`scan`, `scan_project`, `scan_file`,
   `scan_diff`, `apply_fix`, `baseline`) flows through this function,
   and so does the CLI `--format agent` output. Conditional spread
   added here once; both surfaces inherit it.

The `json` formatter and the SARIF formatter are scoped for human/CI tooling
rather than agent consumption; reason codes are additive there too but their
absence today is acceptable — they will pick up the field when the forwarder
in `src/output/formatters/json.ts` is similarly extended. That's a follow-up
commit paired with the first rule that populates the field (no point
surfacing a field that nothing emits yet).

### Engine ownership

None. Rules populate; forwarders pass through. `EmittedViolation` does not
exclude `couldBeWrongBecause` (it remains assignable from rules via
`ctx.emit()`), matching the handling of `suggestion`, `fix`, `fixPaths`, and
`snippet` — all optional, rule-populated, engine-passes-through fields.

## Consequences

- `Violation` grows by one optional field. Existing producers don't change;
  the field is absent on every Violation until a rule opts in.
- The single shared `buildAgentFinding` builder (consumed by both the
  MCP tools and the CLI agent formatter) picks up a conditional spread.
  Consumers that didn't know to look for the field see no change;
  agents that key off it can begin triaging as soon as the first rule
  opts in.
- Semver: minor bump. New optional output field is additive.
- Follow-up work (per-rule opt-in) is tracked as discrete tasks under
  Q2R2-CWBB's children, not batched here. First opt-in candidates:
  `forms/required-indicator-missing` → `replacement_indicator_in_sibling_file`;
  contrast rules → `tailwind_class_on_consumer`.
