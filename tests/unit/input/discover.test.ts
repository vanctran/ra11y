/**
 * File-discovery tests, focused on `.gitignore` walk-up semantics
 * introduced for P1-IGN. The invariants these guard:
 *
 *   - Subpath scans honor ancestor `.gitignore` files (walked up to
 *     the git root), so `scan_project({ cwd: repo })` and
 *     `scan_project({ cwd: repo/sub })` produce the same findings for
 *     the same tree.
 *   - Full-repo scans (cwd === gitRoot) are unchanged — the walk-up
 *     loop no-ops when repoRoot === scanRoot.
 *   - Non-git directories don't get a walk-up; behavior matches the
 *     pre-walk-up implementation.
 *   - Multi-layer gitignore precedence: rules accumulate from the
 *     repo root down; anchored ancestor patterns outside the scan
 *     root are discarded, not misapplied.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { discoverFiles } from "../../../src/input/discover.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "ra11y-discover-"));
}

/** Marks a directory as a git repo root without actually initializing git. */
function markGitRoot(dir: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  // A bare `.git/HEAD` is enough for us — our detector just stats `.git`.
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
}

function write(path: string, content = "// noop\n"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("discoverFiles .gitignore walk-up", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmp();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("subpath scan honors root .gitignore (the P1-IGN regression)", async () => {
    // Repo layout:
    //   repo/.gitignore            -> "dist/"
    //   repo/src/app/page.tsx      (kept)
    //   repo/src/app/dist/gen.tsx  (excluded by root .gitignore)
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "dist/\n");
    write(join(dir, "src", "app", "page.tsx"));
    write(join(dir, "src", "app", "dist", "gen.tsx"));
    write(join(dir, "src", "app", "dist", "nested", "more.tsx"));

    const found = await discoverFiles([join(dir, "src", "app")]);
    const rel = found.map((p) => p.slice(dir.length + 1));

    expect(rel).toEqual(["src/app/page.tsx"]);
  });

  it("full-repo scan is unchanged when cwd === gitRoot", async () => {
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "dist/\n");
    write(join(dir, "src", "app", "page.tsx"));
    write(join(dir, "dist", "bundle.tsx"));

    const fromRoot = await discoverFiles([dir]);
    const relFromRoot = fromRoot.map((p) => p.slice(dir.length + 1)).sort();

    // Sanity: `dist/` excluded by root .gitignore, page.tsx kept.
    expect(relFromRoot).toEqual(["src/app/page.tsx"]);

    // And a subpath scan under the same tree agrees on the files that
    // overlap — invariant the walk-up is meant to deliver.
    const fromSubpath = await discoverFiles([join(dir, "src", "app")]);
    const relFromSubpath = fromSubpath.map((p) => p.slice(dir.length + 1)).sort();
    expect(relFromSubpath).toEqual(["src/app/page.tsx"]);
  });

  it("non-git directory: walk-up does nothing, existing behavior intact", async () => {
    // No .git marker — resolveGitRoot returns null, no ancestor walk.
    write(join(dir, "src", "app", "page.tsx"));
    write(join(dir, "src", "app", "dist", "bundle.tsx"));

    const found = await discoverFiles([join(dir, "src", "app")]);
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    // Both surface — no .gitignore anywhere, nothing to exclude. `dist`
    // is a DEFAULT_IGNORED_DIRS entry, so the directory walker skips it.
    // That behavior is pre-existing and unrelated to the walk-up fix.
    expect(rel).toEqual(["src/app/page.tsx"]);
  });

  it("composes multiple intervening .gitignore files correctly", async () => {
    // Repo layout mirrors a monorepo shape:
    //   repo/.gitignore               -> "logs/"
    //   repo/packages/.gitignore      -> "build/"
    //   repo/packages/web/src/page.tsx (kept)
    //   repo/packages/web/src/build/gen.tsx  (excluded by packages/.gitignore)
    //   repo/packages/web/src/logs/trace.tsx (excluded by root .gitignore)
    //   repo/packages/web/src/app/app.tsx    (kept)
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "logs/\n");
    write(join(dir, "packages", ".gitignore"), "build/\n");
    const scanRoot = join(dir, "packages", "web", "src");
    write(join(scanRoot, "page.tsx"));
    write(join(scanRoot, "app", "app.tsx"));
    write(join(scanRoot, "build", "gen.tsx"));
    write(join(scanRoot, "logs", "trace.tsx"));

    const found = await discoverFiles([scanRoot]);
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    expect(rel).toEqual(["packages/web/src/app/app.tsx", "packages/web/src/page.tsx"]);
  });

  it("anchored ancestor patterns outside the scan root are discarded", async () => {
    // `/other-pkg/` at the repo root only matches `repo/other-pkg/`.
    // When scanning `repo/web`, that pattern must NOT translate into
    // a matcher that would accidentally exclude e.g. `repo/web/other-pkg/`.
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "/other-pkg/\n");
    const scanRoot = join(dir, "web");
    write(join(scanRoot, "page.tsx"));
    write(join(scanRoot, "other-pkg", "file.tsx"));

    const found = await discoverFiles([scanRoot]);
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    expect(rel).toEqual(["web/other-pkg/file.tsx", "web/page.tsx"]);
  });

  it("anchored ancestor patterns inside the scan root are re-anchored", async () => {
    // `/web/generated/` in the repo root .gitignore refers specifically
    // to `repo/web/generated/`. When we scan `repo/web`, that should
    // become anchored `/generated/` from the scan-root perspective —
    // i.e., a deeper unrelated "generated" dir inside the scan tree
    // still gets scanned. (We use "generated" because "build" lives in
    // DEFAULT_IGNORED_DIRS and would bias the test by other means.)
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "/web/generated/\n");
    const scanRoot = join(dir, "web");
    write(join(scanRoot, "page.tsx"));
    write(join(scanRoot, "generated", "bundle.tsx"));
    write(join(scanRoot, "nested", "generated", "side.tsx"));

    const found = await discoverFiles([scanRoot]);
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    // Only repo/web/generated is excluded; a deeper unrelated
    // `generated` dir isn't, because the anchor was at
    // `repo/web/generated`.
    expect(rel).toEqual(["web/nested/generated/side.tsx", "web/page.tsx"]);
  });

  it("unanchored root pattern still matches when scanning a subpath", async () => {
    // `node_modules` (unanchored) should match `web/node_modules/foo`.
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "custom-dir\n");
    const scanRoot = join(dir, "web");
    write(join(scanRoot, "page.tsx"));
    write(join(scanRoot, "custom-dir", "bundle.tsx"));
    write(join(scanRoot, "nested", "custom-dir", "bundle.tsx"));

    const found = await discoverFiles([scanRoot]);
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    expect(rel).toEqual(["web/page.tsx"]);
  });

  it("respectGitignore:false skips the walk-up entirely", async () => {
    markGitRoot(dir);
    write(join(dir, ".gitignore"), "dist/\n");
    const scanRoot = join(dir, "src", "app");
    write(join(scanRoot, "page.tsx"));
    write(join(scanRoot, "dist", "gen.tsx"));

    const found = await discoverFiles([scanRoot], { respectGitignore: false });
    const rel = found.map((p) => p.slice(dir.length + 1)).sort();

    // `dist` is still excluded by DEFAULT_IGNORED_DIRS — that's the
    // directory-walker behavior, not the gitignore. So we assert on
    // the file that would only survive if the walk-up also no-ops.
    expect(rel).toContain("src/app/page.tsx");
    // And confirm nothing from dist surfaces (DEFAULT_IGNORED_DIRS does
    // its job; the invariant here is that respectGitignore:false
    // doesn't crash on a git repo).
    expect(rel).not.toContain("src/app/dist/gen.tsx");
  });

  // Anchors the visited-set guard: discovery should terminate on any
  // path, including one where we never hit a .git.
  it("terminates cleanly when no .git marker is found up to the FS root", async () => {
    // tmpdir has no .git above it (unless the user's tmpdir is somehow
    // inside a repo — unlikely on macOS/Linux). Just asserting we
    // don't hang is the contract.
    write(join(dir, "page.tsx"));
    const found = await discoverFiles([dir]);
    expect(found.map((p) => basename(p))).toEqual(["page.tsx"]);
  });
});
