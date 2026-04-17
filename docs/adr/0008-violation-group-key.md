# 8. Violation.groupKey — stable grouping by rule + normalized AST shape

Date: 2026-04-17
Status: Accepted

## Context

`Violation.findingId` (ADR-adjacent — introduced in commit 49f9227) gives each
finding a stable cross-run identity. That identity is *per-finding*: two
identical `<img>` elements in two files get two different `findingId`s because
`filePath` is part of the input.

Agent consumers want a **different** key with the opposite polarity: "group
every finding that is the same kind of problem, regardless of where it lives,
so I can write one fix and loop." Filename and identifier-specific data MUST
NOT feed this key; the shape of the target node does.

Concrete callers:

- "Fix every finding with groupKey X the same way" — an agent batches one
  rewrite across 40 call sites.
- `scan_diff` can deduplicate noise when the same pattern proliferates under
  refactor.
- A future `aggregate_findings` MCP surface can collapse buckets honestly
  without the consumer re-deriving the pattern.

## Decision

Every `Violation` carries a new required field:

```ts
readonly groupKey: string;
```

Computed as the first `GROUP_KEY_HEX_LENGTH` hex chars of
`sha256(ruleId + "\0" + normalizedShape)`. `normalizedShape` is a canonical
string produced by a new helper `describeNodeShape(node)` in
`src/engine/ast-helpers.ts`.

### Normalization rules

1. **Kind is preserved.** `jsx:button`, `html:img`, `css:rule` lead every
   shape string; different kinds never collide.
2. **Attribute / property NAMES are preserved; VALUES are stripped.**
   `<img alt="a">` and `<img alt="b">` hash the same; missingness is encoded
   (`[no-alt]`) so a missing `alt` hashes differently from a present one.
3. **Children structure is coarse-grained**: `[empty]`, `[text]`, `[expr]`,
   `[element]`, `[mixed]`. Literal text never feeds the hash.
4. **Position in file is excluded.** Same reason `findingId` excluded line
   numbers — we want resilience to whitespace drift across files.
5. **Pseudo-classes / pseudo-elements are preserved on CSS selectors**
   (`[pseudo=:focus-visible]`) because they alter the meaning of the rule.
6. **Declaration property names** on CSS rules are preserved, values are
   stripped (`[decl=outline,color]`).

### Fallback

When the target node cannot be resolved or described (location doesn't map
onto any parsed AST node — synthetic crash records, project-scope rules
with no nodal target), `normalizedShape` is `"unknown-shape"`. Every such
finding under a single rule ID lands in the same group; that's an honest
grouping ("the un-groupable" per that rule).

### Engine ownership

Rules do **not** compute `groupKey`. The engine does, at the same site where
`findingId` is stamped. This preserves the invariant that rules are pure
content — they don't know their own hashing recipe.

The engine finds the target node by walking the parsed AST for the innermost
node whose source range contains `(location.line, location.column)`. This
keeps the rule API unchanged and avoids a 50+ rule migration.

### Constants

`GROUP_KEY_HEX_LENGTH = 12` — matches `FINDING_ID_LENGTH`. 48 bits is plenty
to distinguish groups within a single scan; short enough to read cleanly in
agent transcripts.

## Consequences

- `Violation` grows by one required field. Every producer — scanner, project
  rule path, synthetic crash records, baseline cross-run match helpers, test
  helpers — stamps it.
- `EmittedViolation = Omit<Violation, ... | "groupKey">` — rules cannot set
  it, by construction.
- Formatters that pass findings through to agents (`agent`, `json`,
  MCP `formatFinding`, SARIF) surface `groupKey` so consumers can bucket
  without re-computing.
- Two findings from the same rule firing on AST-equivalent nodes across
  files now share a `groupKey`. Two findings from the same rule firing on
  AST-distinct nodes (different tag, different attribute set, different
  children shape) have different `groupKey`s. Different rules on the same
  node have different `groupKey`s.
- Semver: minor bump. New required output field is additive for consumers
  that didn't look for it.
