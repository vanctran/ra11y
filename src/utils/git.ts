/**
 * Minimal git helpers for `--changed` / `--since` file discovery and
 * for the hunk-intersection mode of `scan_diff`.
 *
 * These shell out to `git` via spawnSync — we don't link libgit2 or
 * any native binding. The small surface we need (list staged files,
 * list files changed since a ref, enumerate changed hunks from a
 * unified-0 diff) is well-supported by plain git commands, and
 * shelling out costs a single sub-process per scan.
 *
 * The functions return absolute paths. Callers can intersect with
 * positional-arg paths to scope a scan to "staged files under src/".
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Returns true if the current working directory is inside a git repo. */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout ?? "").trim().length > 0;
}

/** Absolute path to the git repo root, or null if not a repo. */
export function gitRoot(cwd: string = process.cwd()): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const out = (result.stdout ?? "").trim();
  return out.length === 0 ? null : out;
}

/**
 * Returns absolute paths of files that are currently staged in the
 * index (whether they've been modified on top of that or not). This
 * is what `--changed` scans when used as a precommit hook.
 */
export function stagedFiles(cwd: string = process.cwd()): string[] {
  const root = gitRoot(cwd);
  if (root === null) return [];
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return [];
  return parseFileList(result.stdout ?? "", root);
}

/**
 * Returns the SHA of the nearest commit on HEAD's history at or before
 * the given ISO-8601 timestamp. Used by attestation staleness: an
 * attestation records `attestedAt` but no commit; this helper picks the
 * commit the author's tree likely reflected, so "changed since the
 * attestation" can be computed as `git diff <stamp> HEAD`.
 *
 * Returns null if the lookup fails (not a repo, no commits before the
 * stamp, git unavailable). Callers treat null as "staleness
 * indeterminate — omit the field," which is the honest shape when we
 * can't answer the question.
 */
export function stampCommitForTimestamp(
  isoTimestamp: string,
  cwd: string = process.cwd(),
): string | null {
  const root = gitRoot(cwd);
  if (root === null) return null;
  const result = spawnSync("git", ["rev-list", "-n", "1", `--before=${isoTimestamp}`, "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const sha = (result.stdout ?? "").trim();
  return sha.length === 0 ? null : sha;
}

/**
 * Returns absolute paths of files changed between `stamp` and HEAD,
 * including uncommitted working-tree changes vs HEAD. Used by
 * attestation staleness — any file in an attestation's scope that
 * appears in this list flips `stale: true`. Returns `null` on git
 * failure so callers can distinguish "no files changed" (empty set)
 * from "couldn't answer" (null → omit the field).
 */
export function changedFilesBetween(
  stamp: string,
  cwd: string = process.cwd(),
): Set<string> | null {
  const root = gitRoot(cwd);
  if (root === null) return null;
  const committed = spawnSync("git", ["diff", "--name-only", `${stamp}..HEAD`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (committed.status !== 0) return null;
  const out = new Set<string>(parseFileList(committed.stdout ?? "", root));
  const uncommitted = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (uncommitted.status === 0) {
    for (const f of parseFileList(uncommitted.stdout ?? "", root)) out.add(f);
  }
  return out;
}

/** Current HEAD SHA, or null if the lookup fails. */
export function headSha(cwd: string = process.cwd()): string | null {
  const root = gitRoot(cwd);
  if (root === null) return null;
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const sha = (result.stdout ?? "").trim();
  return sha.length === 0 ? null : sha;
}

/**
 * Returns absolute paths of files changed since the given git ref
 * (e.g., "main", "HEAD~5", "v1.0.0"). Used by `--since <ref>`.
 */
export function filesChangedSince(ref: string, cwd: string = process.cwd()): string[] {
  const root = gitRoot(cwd);
  if (root === null) return [];
  const result = spawnSync("git", ["diff", `${ref}...HEAD`, "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return [];
  // Also include uncommitted changes vs HEAD so `--since main` in a
  // working branch catches WIP files the user hasn't committed yet.
  const uncommitted = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const set = new Set<string>(parseFileList(result.stdout ?? "", root));
  if (uncommitted.status === 0) {
    for (const f of parseFileList(uncommitted.stdout ?? "", root)) set.add(f);
  }
  return [...set];
}

function parseFileList(stdout: string, root: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((rel) => resolve(root, rel));
}

// ─── Hunk-intersection mode ────────────────────────────────────────────────

/**
 * A single changed-line range inside a file, in post-image line
 * numbers (the line numbers the agent sees in the working tree). `end`
 * is inclusive. Pure-delete hunks (no post-image lines) don't produce
 * a range — they can't host a finding.
 */
export interface HunkRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Result of enumerating the changed hunks for a given comparison ref.
 *
 * The three error variants are distinct failure modes the caller wants
 * to surface with different error codes:
 *   - `not-a-git-repo`: `cwd` is outside any git checkout. Detected via
 *     `git rev-parse --show-toplevel` returning non-zero.
 *   - `unknown-ref`: `cwd` IS a repo, but `git rev-parse --verify <ref>`
 *     returned non-zero — the ref doesn't resolve. (A ref that resolves
 *     but has no diff yields `ok` with an empty map, not this variant.)
 *   - `no-hunks`: the ref resolved and `git diff --unified=0` produced
 *     no output — e.g. clean working tree against HEAD. Surfaces as a
 *     soft `warnings: ["no_hunks_in_comparison"]` signal, not a hard
 *     error.
 */
export type ChangedHunksResult =
  | { readonly status: "ok"; readonly hunksByFile: ReadonlyMap<string, readonly HunkRange[]> }
  | { readonly status: "not-a-git-repo" }
  | { readonly status: "unknown-ref" }
  | { readonly status: "no-hunks" };

/**
 * Returns true when `ref` resolves to something in the repo rooted at
 * `cwd`. Used to distinguish "not a git repo" (no toplevel) from
 * "unknown ref" (toplevel but ref doesn't verify) so callers can emit
 * distinct structured error envelopes.
 */
function refExists(ref: string, cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

/**
 * Parses a `@@ -a,b +c,d @@` hunk header and returns the post-image
 * line range. Accepts the no-comma form (`@@ -a +c @@`, lineCount = 1)
 * and the pure-add form (`-0,0 +c,d`). Returns `null` for malformed
 * input or for pure-delete hunks (`+c,0` — nothing in the post-image
 * to host a finding).
 */
export function parseHunkHeader(line: string): HunkRange | null {
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  const m = re.exec(line);
  if (m === null) return null;
  const start = Number.parseInt(m[1] ?? "", 10);
  const countRaw = m[2];
  const count = countRaw === undefined ? 1 : Number.parseInt(countRaw, 10);
  if (!(Number.isFinite(start) && Number.isFinite(count))) return null;
  if (count === 0) return null; // pure-delete hunk: no post-image lines.
  return { start, end: start + count - 1 };
}

/**
 * Walks the `git diff --unified=0` output and groups post-image hunk
 * ranges by absolute file path. The diff format alternates `diff --git
 * a/<path> b/<path>` preambles with one-or-more `@@` hunk headers per
 * file. Binary files are emitted as `Binary files … differ` with no
 * hunks — they drop out naturally. Renames without content changes
 * emit `rename from`/`rename to` and no hunk headers — they also drop
 * out naturally. When the file is truly content-changed, we use the
 * post-image `b/<path>` so rename-with-changes flows to the new path.
 */
export function parseDiffOutput(
  stdout: string,
  repoRoot: string,
): ReadonlyMap<string, readonly HunkRange[]> {
  const byFile = new Map<string, HunkRange[]>();
  let current: string | null = null;
  for (const raw of stdout.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      // Parse post-image path: `diff --git a/<pre> b/<post>`. We match
      // the trailing ` b/<post>` so a filename containing spaces still
      // resolves — git quotes paths with spaces, but even without that
      // guard the `b/` prefix is unambiguous at the end.
      const idx = raw.lastIndexOf(" b/");
      if (idx === -1) {
        current = null;
      } else {
        const post = raw.slice(idx + 3);
        current = resolve(repoRoot, post);
      }
      continue;
    }
    if (raw.startsWith("@@ ") && current !== null) {
      const range = parseHunkHeader(raw);
      if (range === null) continue;
      const list = byFile.get(current);
      if (list === undefined) byFile.set(current, [range]);
      else list.push(range);
    }
  }
  return byFile;
}

/**
 * Enumerates the post-image hunks produced by `git diff --unified=0
 * <ref>` run from the repo root. Distinguishes not-a-git-repo,
 * unknown-ref, and no-hunks so callers can turn each into the right
 * response shape (hard error envelope vs soft warning). Shells out
 * with `spawnSync` and array args — never through a shell — to keep
 * the ref value out of command interpolation.
 */
export function getChangedHunks(ref: string, cwd: string = process.cwd()): ChangedHunksResult {
  const root = gitRoot(cwd);
  if (root === null) return { status: "not-a-git-repo" };
  if (!refExists(ref, root)) return { status: "unknown-ref" };
  const result = spawnSync("git", ["diff", "--unified=0", "--no-color", ref], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return { status: "unknown-ref" };
  const stdout = result.stdout ?? "";
  if (stdout.trim().length === 0) return { status: "no-hunks" };
  // Canonicalize the repo root before joining hunk paths. macOS temp
  // dirs symlink `/var/folders/...` → `/private/var/folders/...`, and
  // `git rev-parse --show-toplevel` returns the canonicalized form
  // while the caller-supplied `cwd` stays in the symlinked form —
  // leaving the hunk keys in the canonical space would miss every
  // caller-space finding path at lookup time. `isInsideHunk` also
  // canonicalizes the lookup key so both sides agree.
  const rootReal = safeRealpath(root);
  const hunksByFile = parseDiffOutput(stdout, rootReal);
  if (hunksByFile.size === 0) return { status: "no-hunks" };
  return { status: "ok", hunksByFile };
}

/**
 * `realpathSync` wrapper that falls back to the input on error. The
 * only expected failure is a path that doesn't exist on disk — which
 * shouldn't happen here since we only call it on paths git itself
 * just enumerated — but swallowing the error is the right call for a
 * helper whose job is "canonicalize when possible." A non-canonical
 * fallback just means we'd miss cross-symlink-space comparisons,
 * which was the pre-canonicalization baseline anyway.
 */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * True when `(filePath, line)` falls inside at least one hunk range.
 * Linear scan over the per-file range list — hunks-per-file is tiny
 * in practice (a big PR is dozens, not thousands), so a Map lookup +
 * linear scan beats the ceremony of an interval tree.
 */
export function isInsideHunk(
  filePath: string,
  line: number,
  hunksByFile: ReadonlyMap<string, readonly HunkRange[]>,
): boolean {
  // Canonicalize the lookup side too — see `getChangedHunks` for why:
  // macOS `/var/folders/...` ↔ `/private/var/folders/...` disagreement
  // between caller-supplied cwd and `git rev-parse --show-toplevel`
  // output. The hunk map keys are already in canonical space (the
  // helper call site canonicalized the repo root before joining).
  const ranges = hunksByFile.get(filePath) ?? hunksByFile.get(safeRealpath(filePath));
  if (ranges === undefined) return false;
  for (const r of ranges) {
    if (line >= r.start && line <= r.end) return true;
  }
  return false;
}
