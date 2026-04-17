# Prompt evals harness

Offline, CI-gated evaluation of ra11y's built-in MCP prompts
(`src/mcp/prompts/`). Deterministic shape + content checks against
labeled fixtures, with a scripted fake MCP host for sampling-rail
round-trips. No real network, no real LLM.

## What this harness measures

For each entry in `BUILTIN_PROMPTS`:

1. **Render determinism.** `prompt.render(args)` produces a
   `PromptMessage[]` whose text contains every required `anchor` and
   none of the `forbiddenAnchor` substrings for the given arguments.
   Catches drift in template text when someone edits a prompt without
   remembering what concepts it promises to cover (scan-confidence
   vocabulary, workflow tool names, conformance-verdict strings, …).
2. **Branch correctness.** Prompts with optional arguments have two
   rendering branches (e.g. `triage` with vs without `focus`).
   Fixtures cover both so the no-arg default can't leak into the
   arg-supplied rendering and vice versa.
3. **Workflow step ordering.** When `orderedSteps` is set, each step
   marker must appear in strictly increasing position in the rendered
   text — catches reordering regressions a plain substring search
   would miss.
4. **Sampling-request shape.** Each rendered message array is
   converted to a `SamplingRequest` and fed through `sample()`
   against a `ScriptedHost`. Proves the prompt output is a valid
   input to the sampling rail end to end, with no model involved.

## What this harness does NOT measure

- **Model accuracy.** We cannot measure whether an LLM produces the
  right output offline. Real accuracy evals land once
  sampling-backed tools ship — e.g. in
  `tests/integration/mcp-sampling.test.ts`, where a future test can
  reuse `scripted-host.ts` with curated canned responses to exercise
  a tool's post-sampling reasoning.
- **Semantic equivalence.** `anchors` are literal substrings. If the
  prompt rewrites "fail" to "failed" the fixture fails loudly; that's
  a feature (prompt text is load-bearing; agents rely on the exact
  verdict vocabulary) and in the rare case the rewrite is intentional
  the fixture updates in the same commit.
- **Cross-prompt consistency.** Each fixture is self-contained. If
  two prompts should share a concept (e.g. `fail`/`dismiss`/`investigate`
  verdicts appearing in both `triage` and `audit`), add that anchor
  to both fixtures explicitly — we don't infer.

## Files

- `fixtures/index.ts` — labeled inputs: `{ label, promptName, args,
  anchors, forbiddenAnchors?, orderedSteps? }`.
- `scripted-host.ts` — fake host exposing an `McpSession` with a
  queued-response `sendRequest` slot. Reusable by future
  sampling-backed integration tests.
- `harness.ts` — runner: `evaluateFixture(fixture)` /
  `evaluateAll(fixtures)` returning `EvalOutcome` / `EvalReport`.
- `prompts.eval.ts` — `bun test` entry point; one `it(...)` per
  fixture plus harness-level parity checks.

## Adding a fixture when a prompt changes

1. Identify the new or changed concept. If you added a tool name to
   a prompt's workflow, that tool name is an anchor. If you added a
   new argument branch, add a fixture for the branch on AND off.
2. Append to `PROMPT_FIXTURES` in `fixtures/index.ts`. Use the
   `label` field to describe what the fixture guards against — not
   what the prompt says. "triage — focused on wcag22:1.4.3" tells
   the reader the branch; "triage test 1" tells them nothing.
3. Keep `anchors` literal and minimal. Every anchor is a commitment:
   a future prompt edit that removes the string breaks the test, and
   whoever made the edit should think about why.
4. Use `forbiddenAnchors` when the branch you're testing must
   exclude a phrase from the other branch. That's the only way a
   drift in branching logic is caught deterministically.
5. Use `orderedSteps` for numbered workflows (`"1."`, `"2."`, …).
6. Run `bun test tests/evals/` to confirm.

## Relationship to other suites

- `tests/integration/mcp-prompts.test.ts` tests the wire protocol
  (`prompts/list`, `prompts/get` over stdio). This harness tests the
  rendered content — they're complementary.
- `tests/unit/mcp/sampling.test.ts` tests the `sample()` function's
  coerce-and-gate logic in isolation. This harness proves
  prompt-rendered messages are a valid input to that function.
- Future sampling-backed tools should import `scripted-host.ts`
  directly; do not duplicate the fake elsewhere.
