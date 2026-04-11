---
name: fix-drift
description: Regenerates auto-generated docs (docs/kb/wcag/, docs/kb/rules/, kb index, llms.txt, docs/api/) and commits the result so check-kb-drift passes. Use after any rule or standard change.
allowed-tools: Bash(bun *) Bash(git *)
---

# /fix-drift

Regenerates drift-managed artifacts and commits the result.

## Gates

1. `bun scripts/generate-wcag-kb.ts` — rebuild `docs/kb/wcag/*.md` from `src/standards/*/criteria.ts`
2. `bun scripts/generate-rule-kb.ts` — rebuild `docs/kb/rules/*.md` from rule `docs` metadata
3. `bun scripts/generate-kb-index.ts` — rebuild `docs/kb/index.md`, `docs/kb/llms.txt`, `docs/kb/llms-full.txt`
4. `bun run docs:api` — rebuild `docs/api/` from TSDoc via typedoc
5. `bun scripts/check-kb-drift.ts` — assert everything is in sync

## Workflow

1. Preflight: clean working tree except under `docs/kb/` and `docs/api/` (those are about to change anyway).
2. Run gates 1–4 in order.
3. `git diff --stat docs/` to see what actually changed.
4. If nothing changed: report "no drift" and exit 0 without committing.
5. If something changed: stage only the drift files (`git add docs/kb docs/api`), run gate 5 to confirm, then commit with `chore(kb): regenerate drift artifacts`.
6. Report the file list.

## Safety

- Never regenerate anything outside `docs/kb/` or `docs/api/`.
- Never overwrite hand-written docs (concepts, patterns, architecture, gotchas, glossary).
- If a generator produces a diff on a hand-written doc, that's a generator bug — report it and stop.
