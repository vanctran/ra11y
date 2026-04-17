/**
 * Unit tests for the hunk-parsing helpers in `src/utils/git.ts` used by
 * `scan_diff` (hunksOnly mode). The helpers run on raw `git diff --unified=0`
 * output; these tests exercise the parser deterministically without
 * invoking git itself, so we can cover edge cases (pure-add, pure-delete,
 * no-comma line counts, binary files, renames-without-content-change) in
 * one place.
 */

import { describe, expect, it } from "bun:test";
import { isInsideHunk, parseDiffOutput, parseHunkHeader } from "../../../src/utils/git.ts";

describe("parseHunkHeader", () => {
  it("parses the canonical `@@ -a,b +c,d @@` form", () => {
    const r = parseHunkHeader("@@ -10,2 +12,3 @@ function foo() {");
    expect(r).toEqual({ start: 12, end: 14 });
  });

  it("parses the no-comma form (line count defaults to 1)", () => {
    const r = parseHunkHeader("@@ -10 +12 @@");
    expect(r).toEqual({ start: 12, end: 12 });
  });

  it("parses a pure-add hunk with `-0,0` pre-image", () => {
    const r = parseHunkHeader("@@ -0,0 +1,5 @@");
    expect(r).toEqual({ start: 1, end: 5 });
  });

  it("returns null for a pure-delete hunk (+c,0) — no post-image lines to host a finding", () => {
    expect(parseHunkHeader("@@ -3,2 +3,0 @@")).toBe(null);
  });

  it("returns null for malformed headers", () => {
    expect(parseHunkHeader("@@ malformed @@")).toBe(null);
    expect(parseHunkHeader("not a hunk header")).toBe(null);
    expect(parseHunkHeader("")).toBe(null);
  });

  it("tolerates trailing context after the second `@@`", () => {
    const r = parseHunkHeader("@@ -1,1 +1,1 @@ class Foo {");
    expect(r).toEqual({ start: 1, end: 1 });
  });
});

describe("parseDiffOutput", () => {
  const REPO_ROOT = "/tmp/fake-repo";

  it("groups multiple hunks under the post-image path", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,1 +3,1 @@",
      "+line3",
      "@@ -10,0 +12,2 @@",
      "+line12",
      "+line13",
    ].join("\n");
    const byFile = parseDiffOutput(diff, REPO_ROOT);
    const ranges = byFile.get(`${REPO_ROOT}/src/a.ts`);
    expect(ranges).toEqual([
      { start: 3, end: 3 },
      { start: 12, end: 13 },
    ]);
  });

  it("produces no ranges for a binary-file diff (no `@@` headers)", () => {
    const diff = [
      "diff --git a/logo.png b/logo.png",
      "index 111..222 100644",
      "Binary files a/logo.png and b/logo.png differ",
    ].join("\n");
    const byFile = parseDiffOutput(diff, REPO_ROOT);
    expect(byFile.size).toBe(0);
  });

  it("produces no ranges for a rename-only diff (no `@@` headers)", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
    ].join("\n");
    const byFile = parseDiffOutput(diff, REPO_ROOT);
    expect(byFile.size).toBe(0);
  });

  it("attaches hunks to the post-image path on a rename-with-changes", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 80%",
      "rename from old.ts",
      "rename to new.ts",
      "@@ -5,1 +5,1 @@",
      "+changed",
    ].join("\n");
    const byFile = parseDiffOutput(diff, REPO_ROOT);
    expect(byFile.has(`${REPO_ROOT}/new.ts`)).toBe(true);
    expect(byFile.has(`${REPO_ROOT}/old.ts`)).toBe(false);
  });

  it("handles multi-file diffs", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,1 +1,1 @@",
      "+a",
      "diff --git a/b.ts b/b.ts",
      "@@ -2,1 +2,1 @@",
      "+b",
    ].join("\n");
    const byFile = parseDiffOutput(diff, REPO_ROOT);
    expect(byFile.size).toBe(2);
    expect(byFile.get(`${REPO_ROOT}/a.ts`)).toEqual([{ start: 1, end: 1 }]);
    expect(byFile.get(`${REPO_ROOT}/b.ts`)).toEqual([{ start: 2, end: 2 }]);
  });
});

describe("isInsideHunk", () => {
  const PATH = "/tmp/fake-repo/src/a.ts";
  const hunks = new Map<string, readonly { start: number; end: number }[]>([
    [
      PATH,
      [
        { start: 5, end: 7 },
        { start: 20, end: 20 },
      ],
    ],
  ]);

  it("returns true for a line inside a range (boundaries inclusive)", () => {
    expect(isInsideHunk(PATH, 5, hunks)).toBe(true);
    expect(isInsideHunk(PATH, 7, hunks)).toBe(true);
    expect(isInsideHunk(PATH, 6, hunks)).toBe(true);
    expect(isInsideHunk(PATH, 20, hunks)).toBe(true);
  });

  it("returns false for a line outside every range", () => {
    expect(isInsideHunk(PATH, 4, hunks)).toBe(false);
    expect(isInsideHunk(PATH, 8, hunks)).toBe(false);
    expect(isInsideHunk(PATH, 19, hunks)).toBe(false);
  });

  it("returns false for an unknown file path", () => {
    expect(isInsideHunk("/tmp/fake-repo/other.ts", 5, hunks)).toBe(false);
  });
});
