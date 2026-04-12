/**
 * Minimal git helpers for `--changed` and `--since` file discovery.
 *
 * These shell out to `git` via spawnSync — we don't link libgit2 or
 * any native binding. The small surface we need (list staged files,
 * list files changed since a ref) is well-supported by plain git
 * commands, and shelling out costs a single sub-process per scan.
 *
 * The functions return absolute paths. Callers can intersect with
 * positional-arg paths to scope a scan to "staged files under src/".
 */

import { spawnSync } from "node:child_process";
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
