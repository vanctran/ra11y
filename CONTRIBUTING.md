# Contributing to ra11y

Thanks for your interest. ra11y's quality bar is high — the tool exists to help organizations achieve accessibility certification, so rule correctness and reliability are the product. This guide tells you how to contribute effectively.

Read [`CLAUDE.md`](./CLAUDE.md) first — it is the authoritative spec for the architecture, invariants, and workflow. Everything below is the human-facing subset.

## Ground rules

1. **Zero runtime dependencies.** `dependencies: {}` in `package.json`. If you need a utility, write it in `src/utils/`. CI enforces this via `scripts/check-zero-deps.ts`.
2. **TypeScript only, Bun first.** Every file is `.ts`. Scripts run with `bun <file>.ts`. Shipped artifact must run on Node 22+ — no `Bun.file()` or `Bun.serve()` in `src/`.
3. **Every rule cites WCAG.** The file header lists the SC number(s) and spec URL. Missing either fails CI.
4. **Every violation has a context-aware fix suggestion.** Not generic.
5. **Conventional commits.** `feat(rules): add …`, `fix(engine): …`, `docs(kb): …`. Scope is required for `feat`/`fix`/`refactor`.
6. **Never `--no-verify`.** If a hook fails, fix the underlying problem.
7. **Never amend a pushed commit.** Add a new commit.

## Dev setup

```sh
# Bun is the primary dev runtime
curl -fsSL https://bun.sh/install | bash

git clone https://github.com/vanctran/ra11y.git
cd ra11y
bun install
bun run verify   # typecheck + lint + test + check-deps
```

VS Code users: install the Biome extension. `.vscode/settings.json` is committed so format-on-save and organize-imports-on-save work out of the box.

## The change loop

Every change follows the same shape:

```
1. Pick an item from .claude/backlog.md (or open an issue first if it isn't tracked)
2. Write the code + tests + fixtures + docs in small commits
3. bun run verify
4. Open a PR
```

For rules and standards, use the skill-driven workflow in `CLAUDE.md` section 10. Humans and Claude Code sessions use the same entry points: `/add-rule`, `/add-standard`, `/add-formatter`, `/verify`, `/fix-drift`.

## Adding a rule — the short version

Full walkthrough: `CLAUDE.md` section 7 and `docs/kb/patterns/writing-a-rule.md`.

1. Name it `<domain>/<slug>` (domains are the folders under `src/rules/`).
2. Create `src/rules/<domain>/<slug>.ts` with `defineRule({ satisfies, severity, scope, appliesTo, docs, check })`.
3. Header comment cites every WCAG SC and spec URL.
4. Tests: `tests/unit/rules/<domain>/<slug>.test.ts` with ≥3 positive, ≥3 negative, ≥1 edge case.
5. Fixtures: `tests/fixtures/good/<slug>/`, `tests/fixtures/bad/<slug>/`.
6. Register in `src/rules/index.ts`.
7. Run `/fix-drift` to regenerate `docs/kb/rules/<slug>.md`.
8. Commit in small chunks (see Commit discipline).

## Adding a standard — the short version

1. `src/standards/<id>/standard.ts`, `criteria.ts`, `metadata.ts`.
2. For standards that reference WCAG, use `equivalentTo: ["wcag22:X.Y.Z"]` on each criterion — existing rules cover the new standard for free.
3. Register in `src/standards/index.ts`.
4. Golden-file test: `tests/unit/standards/<id>.test.ts`.
5. Integration test: `tests/integration/<id>-scan.test.ts`.
6. `/fix-drift`.

## Commit discipline

Every commit is atomic and small. One logical change per commit, ≤400 lines net diff. A typical rule produces 5–7 commits: skeleton, logic, unit tests, fixtures, kb entry, final polish. If your work would exceed 7 commits, split it into phases.

Conventional commit types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`. Subject line ≤72 chars. Body required for non-trivial commits.

## Testing

- Runner: `bun test`. Do not add Vitest/Jest/Mocha/Ava.
- Coverage: ≥95% line+branch on engine, rules, standards, parsers, reports, config, utils.
- Every rule has a unit test file with ≥3 positive, ≥3 negative, ≥1 edge case.
- Fixtures organized by rule ID in `tests/fixtures/good/<slug>/` and `tests/fixtures/bad/<slug>/`.
- Formatters have snapshot tests in `tests/snapshot/`.
- CLI is tested by spawning the binary in `tests/cli/` and asserting exit codes + output.
- Parsers have fuzz tests in `tests/fuzz/`.

## Docs

Documentation is a first-class deliverable. See `CLAUDE.md` section 12 for the full policy.

- `docs/kb/` is the indexed knowledge base for agent retrieval. Rule and WCAG files are auto-generated — don't hand-edit them. Concepts, patterns, architecture, and gotchas are hand-written.
- Mermaid diagrams ≤7 nodes, single-direction, labeled edges, preceded by prose.
- Public API exports in `src/api/` have TSDoc with `@param`, `@returns`, `@example`.
- `docs/adr/NNNN-title.md` for non-trivial architectural decisions (append-only).

## Performance

`scripts/bench.ts` enforces a cold-start ≤200ms and the file-count budgets in `CLAUDE.md` section 13. Regressions fail CI. Benchmark history is committed to `docs/performance.md`.

## Semver

- **Patch** (0.1.x): bug fixes, refactors, docs.
- **Minor** (0.x.0): new rules, standards, formatters, flags, plugin API additions.
- **Major** (x.0.0): removing rules, renaming rule IDs, breaking types/CLI.

## Code of Conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Be kind. This project helps real people with disabilities — every contributor matters.

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Do not open public issues for vulnerabilities.
