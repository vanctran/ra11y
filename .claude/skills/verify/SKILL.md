---
name: verify
description: Universal preflight — runs the full check sequence (typecheck, lint, tests, zero-dep, cycles, network isolation, limits, tsdoc, mermaid, kb drift) through the single `bun run verify` entrypoint. Use before every commit and before handing off to another agent.
allowed-tools: Bash(bun *) Bash(bunx *) Bash(git *)
---

# /verify

Runs the full verification suite on the current working tree by invoking the single entrypoint:

```
bun run verify
```

That script (`scripts/verify.ts`) is the ONLY place that names the check sequence. Do not call individual check scripts from this skill — if you want to debug a single check, invoke it directly with `bun scripts/<name>.ts`.

## Behavior

- Runs each check in order, printing `→ <name> ... ok (Nms)` or `FAIL` per check.
- On failure: dumps the failing check's stdout + stderr and exits non-zero at the end. The script does NOT short-circuit — it runs every check so you see the full failure set in one pass.
- On success: one-line summary with total time.

## When to use

- Before every commit (the pre-commit hook already runs `verify:precommit` — this skill is the explicit pre-handoff form).
- Before delegating work to a subagent, so the subagent starts from a known-green tree.
- After any non-trivial change set, as a sanity pass.

## Exit status

- `0` on success.
- `1` on any check failure.
