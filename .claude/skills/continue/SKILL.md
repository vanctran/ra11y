---
name: continue
description: Orchestrator-Workers driver. Reads .claude/backlog.md, picks the next unchecked item, dispatches it to the right specialist subagent, verifies the result, commits, checks off the item, and loops. The primary entry point for autonomous ra11y development.
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(git *) Bash(bun *)
argument-hint: [max-items]
---

# /continue $ARGUMENTS

Drives ra11y forward by walking `.claude/backlog.md` and dispatching one item at a time to the matching specialist subagent. This is the main session acting as orchestrator in the Orchestrator-Workers pattern (`CLAUDE.md` section 10).

**Subagents cannot spawn subagents, so this skill runs in the main conversation** (not `context: fork`). It uses `disable-model-invocation: true` because it should only run when the user explicitly asks — running it implicitly would be surprising.

## Arguments

- `$1` (optional): maximum number of items to handle this invocation. Default `20`. Hard cap `20` — after this many items the skill summarizes and yields control regardless.

## Preconditions

1. Working tree is clean: `git status --porcelain` is empty. If dirty, stop and report — we don't pick up partial state.
2. `bun run verify` passes on current HEAD. If not, the first item of this run is "fix whatever verify is complaining about" — do not move on until green.
3. The backlog file exists.

## Workflow

For each iteration (up to `$1` or 20, whichever is smaller):

1. **Read `.claude/backlog.md`** and find the first unchecked `[ ]` item under the current phase. If the current phase is all done, move to the next phase.
2. **Classify the item** to decide which specialist handles it:
   - `src/rules/**` or "add rule for wcag22:…" → `rule-implementer`
   - `src/standards/**` or "add standard …" → `standard-builder`
   - `src/input/parsers/**` → `parser-author`
   - `src/output/formatters/**` → `formatter-author`
   - `src/types/**` or `src/engine/ast-helpers.ts` → `type-smith`
   - `tests/fixtures/real-world/**` → `fixture-curator`
   - `tests/**` (edge cases, fuzz, property) → `test-author`
   - `docs/**` (user-facing) → `doc-writer`
   - `docs/kb/**` → `spec-researcher` (for specs) or auto-generated via `/fix-drift`
   - `scripts/**` → main session (no specialist)
   - `.github/workflows/**` → main session
   - anything else → main session with a note in the summary
3. **Dispatch** via the Agent tool. Brief the specialist with the backlog item verbatim and pointers to `CLAUDE.md` and the relevant `docs/kb/patterns/…`.
4. **Wait** for the specialist to return. It should have committed its own work — verify via `git log --oneline <start>..HEAD`.
5. **Verify** by running `/verify`. If it fails and the specialist didn't already hand back a BLOCKED: report, re-dispatch with the verify output as feedback. Max 2 re-dispatches before declaring BLOCKED on this item and moving to the next one.
6. **Check off** the backlog item: replace `- [ ]` with `- [x]` on the matching line. Commit: `chore(backlog): check off <item>`.
7. **Loop** back to step 1.

## Termination

- Normal: backlog is empty for the current phase and the next, or `$1`/20 items handled.
- BLOCKED: one item could not be completed after re-dispatch. Report the item, the specialist, the error, and continue to the next unblocked item.
- Interrupted: user pressed Ctrl-C or the session ended. The last committed state is always recoverable — subsequent `/continue` picks up where it stopped.

## Reporting

After the loop, output:

```
continue summary
----------------
iterations: 7
completed:
  - Phase 2 · src/types/standard.ts        (type-smith)
  - Phase 2 · src/types/rule.ts            (type-smith)
  - Phase 3 · wcag22 metadata              (standard-builder)
  - Phase 3 · wcag22 criteria batch 1/4    (standard-builder)
  - Phase 3 · wcag22 criteria batch 2/4    (standard-builder)
  - Phase 3 · wcag22 criteria batch 3/4    (standard-builder)
  - Phase 3 · wcag22 criteria batch 4/4    (standard-builder)
blocked:
  (none)
remaining_in_phase: 4 items
next_invocation: suggest /continue with remaining_in_phase
```

## Safety

- Never rewrite history. Only additive commits.
- Never force-push. Only push if the user explicitly asks.
- Never delete files without a corresponding backlog item asking you to.
- On any uncertainty about an item's scope, skip it and include it in the "blocked" list with a note — don't guess.

Gotchas: see [gotchas.md](gotchas.md).
