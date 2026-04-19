# 0012 — Wrapper introspection is an audit signal, not the source of truth

- Status: Accepted
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

A round-2 consumer eval asked for a wrapper-introspection capability: parse
a component's definition file, classify the rendered root element
(`button` / `a` / `input` / `div` / opaque), cache by file hash. One-hop
discipline, no transitive import following. The explicit design question
in the backlog: "does this derive `nativeWrappers` entirely (retiring the
config field) or stay as an audit signal?"

Two follow-up items depend on the answer:

- **Q2R2-DRIFT** (already landed, `b645b81`). Fires at wrapper
  DEFINITION files when the declared `nativeWrapperElements[Name]`
  target no longer matches the first rendered tag.
- **Q2R2-INHERITED** (pending). Synthesizes inherited findings at
  call sites for a finding that originally fired at the wrapper
  definition.

Three prior ADRs and the doctrine in `docs/kb/architecture/ai-first-consumer.md`
constrain the choice:

- **AI-first consumer §"No heuristic suppression."** A scanner that
  auto-derives `nativeWrappers` from introspection alone would silently
  silence call-site findings whenever the probe guessed right — *and*
  whenever it guessed wrong, turning a deterministic config field into a
  heuristic. Silent misses are the failure mode the doctrine exists to
  prevent.
- **AI-first consumer §"Don't duplicate capability the agent already
  has."** The agent can read the wrapper's definition with `Read` and
  tell a compliant button from a div-in-button-clothing in one pass.
  In-tool classification that the agent cannot audit is a liability.
- **§"Interrogate the problem."** Field reports asking for "smarter
  wrapper detection" carry the user pain ("findings on wrappers are
  noisy"), not evidence that the config is the wrong primitive. The
  config field is load-bearing — `nativeWrappers` is how users
  *declare* a contract ("treat `Button` as `button`"); drift (`DRIFT`
  rule, already shipped) is how we verify it; introspection is the
  discovery aid that fills the config when the user hasn't.

## Decision

**Wrapper introspection is an audit + discovery signal. It never
replaces the `nativeWrappers` config field as the source of truth.**

### Role split

| Concept                          | Owner                                | Shape                                         |
|----------------------------------|--------------------------------------|-----------------------------------------------|
| Declared wrapper → element       | `LoadedConfig.nativeWrapperElements` | `Record<string, string>`, user-authored       |
| Auto-detected wrapper *names*    | `detect_native_wrappers` tool        | `bySource.fromAutoDetect.confirmed` (P1-F)    |
| Introspected rendered root       | `wrapper_introspect` helper (new)    | `{ name, definitionFile, observedRoot }[]`    |
| Drift between declared/observed  | `wrapper/drift` rule (shipped)       | Violation at the definition file              |
| Inherited finding at call site   | `Q2R2-INHERITED` (pending)           | Synthesized per call site                     |

### Introspection is a capability, not an engine replacement

`wrapper_introspect` is a callable MCP tool that returns one record per
candidate wrapper:

```ts
interface WrapperIntrospectionRecord {
  readonly name: string;
  readonly definitionFile: string | null;
  readonly observedRoot: "button" | "a" | "input" | "div" | "opaque" | "unknown";
  readonly confidence: "confirmed" | "assumed" | "unresolved";
}
```

- `confirmed`: first JSX/TSX element in the component body is a native
  interactive tag; P1-F already computes this.
- `assumed`: basename matches a file but the first element is another
  component (opaque to introspection).
- `unresolved`: no basename match in the scan set — honest "no evidence."

The output is **evidence an agent reads**, not a silent rewrite of
`nativeWrappers`. If the user wants to promote an auto-detected or
introspected wrapper into the config, they write it themselves (or the
proposed `propose_config` tool inserts it with the user's confirmation
— that tool already exists, `Q2R2-PROPOSE-CFG`, 70a9cd7).

### One-hop discipline (no transitive import following)

Introspection matches a component **name** to a **file** via the
basename probe (`indexFilesByComponentName` in `src/engine/wrapper-probe.ts`,
extracted in `b645b81`). It does not:

- Follow `import { Button } from "./design-system"` through barrel
  re-exports.
- Resolve through `export * from "./..."`.
- Walk beyond the candidate's own file body.

Rationale: transitive following multiplies the cost of every `scan_project`
call and re-creates the "in-tool heuristic" failure mode — an agent using
`Read` on the output cannot tell whether the chain was resolved correctly.
One-hop keeps the probe deterministic and the cost bounded. When the
basename probe can't resolve, the record is `confidence: "unresolved"` and
the agent decides.

### Cache discipline

Results are cached **per file hash** for the duration of an MCP session.
Cache key is `sha256(filePath + fileContents)` truncated to 16 hex
chars. On file change → natural invalidation via hash mismatch. No
time-based eviction. In-memory only.

### Why this unblocks INHERITED without changing its contract

`Q2R2-INHERITED` synthesizes inherited findings at call sites when a
finding fires at a wrapper definition. With introspection-as-evidence:

- The synthesizer reads `nativeWrapperElements` for the authoritative
  list of wrappers to attribute findings through.
- For wrappers NOT in `nativeWrapperElements` but present in
  `wrapper_introspect` output with `confidence: "confirmed"`, the agent
  can still decide to attribute (by reading the MCP response) — ra11y
  doesn't attribute silently.
- The synthesized findings carry `sourceOfFinding: { file, line }`
  pointing at the wrapper definition and `confidence: "inherited"` so
  downstream consumers see the chain.

## Consequences

**Accepted:**

- Introspection can be called independently (`wrapper_introspect` MCP
  tool) OR as a pre-step inside `detect_native_wrappers` (already wires
  to `classifyWrapperRoot` for the `confirmed` / `assumed` split).
- The `nativeWrappers` config field stays; `DRIFT` continues verifying
  it; INHERITED reads it.
- Agents that want automated wrapper discovery chain
  `detect_native_wrappers` → (human review) → `propose_config` →
  commit. No silent in-tool rewrites.

**Rejected alternatives:**

- **Auto-derive `nativeWrappers` from introspection, retire config.**
  Rejected per AI-first consumer doctrine. The config is a user
  contract; auto-derivation is a heuristic. Replacing contract with
  heuristic silently changes what findings surface when the introspection
  probe changes (e.g., a component refactor breaks the basename probe
  → every call-site finding resurfaces as noise the user can't trace).
- **Return a `suggestedNativeWrappers` payload on every `scan_project`
  call.** Rejected — bloats the scan response; `detect_native_wrappers`
  is the dedicated tool for this question.
- **Transitive import following for higher-recall wrapper discovery.**
  Rejected — violates the "don't duplicate capability the agent already
  has" rule. The agent can follow a chain with `Read` and make the call;
  in-tool chain resolution is the liability mode.

## Implementation notes (non-normative)

`wrapper_introspect` reuses `src/engine/wrapper-probe.ts` helpers that
already landed with `b645b81`:

- `componentNameFromPath` — basename → PascalCase name.
- `indexFilesByComponentName<T extends ProbeFile>` — reverse index.
- `firstJsxRootTag` — returns the first JSX element's tag.

Shape discipline mirrors prior tools: conditional-spread optional
fields, `warnings: string[]` for honest labeling, `nextStep` aligned
pair for the canonical follow-up. Classifying `"div"` vs `"opaque"` vs
`"unknown"` is a mechanical switch on the probed tag; no heuristics.
