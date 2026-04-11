---
name: release
description: Prepares and cuts a ra11y release. Dispatches release-captain with the target version, verifies everything, updates changelog, bumps package.json, tags, and (with user confirmation) pushes. Use only for versioned releases.
argument-hint: <version>
disable-model-invocation: true
allowed-tools: Read Edit Bash(git *) Bash(bun *) Bash(npm *) Bash(gh *)
---

# /release $ARGUMENTS

Cuts a ra11y release at version `$1`. `disable-model-invocation: true` is intentional — only the user should trigger releases, never the model on its own.

## Preconditions

1. On `main`, up to date with origin.
2. Working tree clean.
3. `$1` is a valid semver string.
4. `$1` > current `package.json.version`.
5. `bun run verify && bun run build && bun run bench` all green.

## Workflow

1. **Preflight**: confirm all preconditions.
2. **Dispatch** `release-captain` with `$1`. It owns the full release workflow:
   - Rewrites the `CHANGELOG.md` Unreleased section into a versioned section.
   - Bumps `package.json.version`.
   - Creates the release commit and tag.
   - Returns with the tag created but not pushed.
3. **User confirmation**: print a summary of what will happen when the tag is pushed (CI → npm publish → GitHub release). **Ask the user to confirm before pushing.**
4. **On confirmation**: `git push origin main && git push origin v$1`.
5. **Watch CI**: print the Actions URL. Poll the release workflow until it finishes.
6. **Verify**: `npm view @ra11y/core version` must equal `$1`.
7. **GitHub release**: `gh release create v$1 --notes-file <tmp-changelog-excerpt>`.
8. **Open next cycle**: add a fresh `## [Unreleased]` section at the top of `CHANGELOG.md` and commit `chore(release): open v<next>-dev cycle`.
9. **Report** the final links and version.

## Safety

- **Tag push is irreversible.** Always confirm with the user before step 4.
- **Never publish from a laptop.** CI has provenance configured; local publishes don't.
- **Never force-push anything.** If something goes wrong, cut a patch release.
- **Never skip bench.** A release = measured + green.
- **2FA must be active** on the npm account publishing the release.

## Return format

```
version: v$1
previous: v<x>
bump: major | minor | patch
verify: passed
bench: inside budget
commits: [release commit sha]
tag: v$1
tag_pushed: yes (user confirmed)
ci_status: <link>
npm_status: <link>
github_release: <link>
next_cycle_commit: <sha>
```
