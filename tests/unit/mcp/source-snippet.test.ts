/**
 * Unit tests for buildSnippet — the shared helper that produces the
 * `snippet` field on review_candidates / checklist responses from
 * the source text already held in ParsedFile cache.
 *
 * Invariants under test:
 *   - normal case returns ±3 lines around the target, de-indented
 *   - out-of-bounds / empty source / bad inputs return undefined
 *     (NOT empty string — see CLAUDE.md §1 "Ambiguous field shapes")
 *   - 300-char cap is hard; snippet never exceeds it
 *   - common indent is stripped across all included lines
 */

import { describe, expect, it } from "bun:test";
import { buildSnippet, sourceIndex } from "../../../src/mcp/source-snippet.ts";

const CAP = 300;

describe("buildSnippet: normal path", () => {
  it("returns ±3 lines around the target line", () => {
    const source = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
    ].join("\n");
    const snippet = buildSnippet(source, 5);
    expect(snippet).toBe(
      ["line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8"].join("\n"),
    );
  });

  it("clamps to file start when target line is near the top", () => {
    const source = ["a", "b", "c", "d", "e"].join("\n");
    const snippet = buildSnippet(source, 1);
    expect(snippet).toBe(["a", "b", "c", "d"].join("\n"));
  });

  it("clamps to file end when target line is near the bottom", () => {
    const source = ["a", "b", "c", "d", "e"].join("\n");
    const snippet = buildSnippet(source, 5);
    expect(snippet).toBe(["b", "c", "d", "e"].join("\n"));
  });
});

describe("buildSnippet: de-indent", () => {
  it("strips common leading whitespace across all non-blank lines", () => {
    const source = [
      "    function Foo() {",
      "      return (",
      '        <img src="x" />',
      "      );",
      "    }",
    ].join("\n");
    // Target line 3 — ±3 is lines 1..5 here.
    const snippet = buildSnippet(source, 3);
    // Common leading whitespace across the included lines is 4 spaces.
    expect(snippet).toBe(
      ["function Foo() {", "  return (", '    <img src="x" />', "  );", "}"].join("\n"),
    );
  });

  it("treats blank lines as not contributing to the indent floor", () => {
    const source = ["  a", "", "  b", "  c"].join("\n");
    const snippet = buildSnippet(source, 2);
    // Blank lines don't collapse the strip — the 2-space common indent
    // still gets removed.
    expect(snippet).toBe(["a", "", "b", "c"].join("\n"));
  });
});

describe("buildSnippet: 300-char cap", () => {
  it("never exceeds the cap even when the window is long", () => {
    // Make every line 80 chars — 7-line window would be ~ 560 chars.
    const wideLine = "x".repeat(80);
    const source = Array.from({ length: 20 }, () => wideLine).join("\n");
    const snippet = buildSnippet(source, 10);
    expect(snippet).toBeDefined();
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
  });

  it("keeps the anchor line when the window is shrunk", () => {
    const wideLine = "y".repeat(80);
    const anchorLine = '<anchor attr="value" />';
    const lines = [wideLine, wideLine, wideLine, anchorLine, wideLine, wideLine, wideLine];
    const source = lines.join("\n");
    const snippet = buildSnippet(source, 4);
    expect(snippet).toBeDefined();
    expect(snippet).toContain(anchorLine);
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
  });

  it("truncates a single line that alone exceeds the cap", () => {
    const huge = "z".repeat(500);
    const source = `${huge}\n${huge}\n${huge}`;
    const snippet = buildSnippet(source, 2);
    expect(snippet).toBeDefined();
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
    expect((snippet ?? "").endsWith("…")).toBe(true);
  });
});

describe("buildSnippet: dishonest shapes forbidden", () => {
  it("returns undefined (not empty string) for an empty source", () => {
    expect(buildSnippet("", 1)).toBeUndefined();
  });

  it("returns undefined for an out-of-bounds line", () => {
    const source = ["a", "b", "c"].join("\n");
    expect(buildSnippet(source, 99)).toBeUndefined();
  });

  it("returns undefined for a non-positive line number", () => {
    const source = "a\nb\nc";
    expect(buildSnippet(source, 0)).toBeUndefined();
    expect(buildSnippet(source, -3)).toBeUndefined();
  });

  it("returns undefined for non-integer line numbers", () => {
    const source = "a\nb\nc";
    expect(buildSnippet(source, 1.5)).toBeUndefined();
  });
});

describe("sourceIndex", () => {
  it("maps ParsedFile.filePath to its source text", () => {
    const files = [
      {
        filePath: "/a.tsx",
        source: "hello",
        // biome-ignore lint/suspicious/noExplicitAny: unit test sees only filePath+source
        ast: {} as any,
      },
      {
        filePath: "/b.tsx",
        source: "world",
        // biome-ignore lint/suspicious/noExplicitAny: unit test sees only filePath+source
        ast: {} as any,
      },
    ];
    const idx = sourceIndex(files);
    expect(idx.get("/a.tsx")).toBe("hello");
    expect(idx.get("/b.tsx")).toBe("world");
    expect(idx.get("/missing.tsx")).toBeUndefined();
  });
});
