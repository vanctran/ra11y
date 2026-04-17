/**
 * Unit tests for `src/mcp/build-artifacts.ts` — the deterministic
 * compiled-CSS / bundler-output labeller surfaced as
 * `meta.scannedBuildArtifacts` on `scan_project` responses.
 *
 * Two directions:
 *   1. Each of the three signals (escaped-bracket Tailwind selector,
 *      large `.css` file, bundler-output path substring) fires on its
 *      named condition AND only on its named condition — over-labeling
 *      a hand-written stylesheet would push the agent to investigate
 *      non-generated code, the expensive failure mode.
 *   2. `collectBuildArtifacts` returns an empty array (not `[""]`,
 *      `[null]`, or a placeholder) when no file in the batch matches.
 *      The caller conditional-spreads on that emptiness; a subtle
 *      "always return a list with one element" bug would silently
 *      emit `scannedBuildArtifacts: [""]`.
 */

import { describe, expect, it } from "bun:test";
import { collectBuildArtifacts, isBuildArtifact } from "../../../src/mcp/build-artifacts.ts";

describe("isBuildArtifact — escape-bracket Tailwind selector signal", () => {
  it("matches a `.w-\\[400px\\]` utility selector (pixel width)", () => {
    const source = ".w-\\[400px\\] { width: 400px; }\n";
    expect(isBuildArtifact("app/static/assets/index.css", source)).toBe(true);
  });

  it("matches a `.h-\\[2rem\\]` utility selector (rem height)", () => {
    const source = ".h-\\[2rem\\] { height: 2rem; }\n";
    expect(isBuildArtifact("app/styles.css", source)).toBe(true);
  });

  it("matches a `.w-\\[50%\\]` utility selector (percentage)", () => {
    const source = ".w-\\[50%\\] { width: 50%; }\n";
    expect(isBuildArtifact("app/styles.css", source)).toBe(true);
  });

  it("matches a `.focus-visible\\:ring-2` utility (escaped-colon form)", () => {
    // The Tailwind variant form emits `.focus-visible\:` — the escape
    // pattern probes for `\:focus-visible:` which matches the
    // compiler's actual output (`.group\:focus-visible:etc`).
    const source = ".group\\:focus-visible:before { outline: 2px solid blue; }\n";
    expect(isBuildArtifact("app/styles.css", source)).toBe(true);
  });

  it("matches a `.bg-\\[--color\\]` CSS-variable utility", () => {
    const source = ".bg-\\[--my-color\\] { background-color: var(--my-color); }\n";
    expect(isBuildArtifact("app/styles.css", source)).toBe(true);
  });

  it("does NOT match hand-written CSS with a normal attribute selector like `[role='button']`", () => {
    const source = "[role='button'] { cursor: pointer; }\n.card { padding: 1rem; }\n";
    expect(isBuildArtifact("app/styles.css", source)).toBe(false);
  });

  it("does NOT match escaped-bracket-like patterns inside a JSX source (pattern gated to .css paths)", () => {
    // A JSX file can carry `.w-\[400px\]` as a className literal; that
    // is Tailwind *usage*, not compiled output. The detector must not
    // label the TSX file as a build artifact.
    const source = 'const x = <div className="w-\\[400px\\]" />;';
    expect(isBuildArtifact("src/Component.tsx", source)).toBe(false);
  });
});

describe("isBuildArtifact — large-CSS signal", () => {
  it("flags a `.css` file with more than 1000 physical lines", () => {
    // Generate 1200 lines of trivial rules — simulates compiled-preflight
    // + utility surface that crosses the threshold.
    const source = Array.from({ length: 1200 }, (_, i) => `.c${i} { color: red; }`).join("\n");
    expect(isBuildArtifact("app/styles.css", source)).toBe(true);
  });

  it("does NOT flag a `.css` file at or below the 1000-line threshold", () => {
    const source = Array.from({ length: 800 }, (_, i) => `.c${i} { color: red; }`).join("\n");
    expect(isBuildArtifact("app/styles.css", source)).toBe(false);
  });

  it("does NOT flag a non-`.css` file regardless of size (line-count signal is CSS-scoped)", () => {
    // A 2000-line HTML file is not a signal of compiled CSS — keep the
    // size probe narrow so large hand-written fixtures don't get mislabeled.
    const source = Array.from({ length: 2000 }, () => "<p>paragraph</p>").join("\n");
    expect(isBuildArtifact("app/index.html", source)).toBe(false);
  });
});

describe("isBuildArtifact — bundler-output path signal", () => {
  it("flags a path under `/dist/`", () => {
    expect(isBuildArtifact("/proj/dist/main.css", ".a {}")).toBe(true);
  });

  it("flags a path under `/build/`", () => {
    expect(isBuildArtifact("/proj/build/out.css", ".a {}")).toBe(true);
  });

  it("flags a path under `/.next/`", () => {
    expect(isBuildArtifact("/proj/.next/static/css/app.css", ".a {}")).toBe(true);
  });

  it("flags a path under `/.svelte-kit/`", () => {
    expect(isBuildArtifact("/proj/.svelte-kit/output/client.css", ".a {}")).toBe(true);
  });

  it("flags a path under `/.output/`", () => {
    expect(isBuildArtifact("/proj/.output/public/_nuxt/entry.css", ".a {}")).toBe(true);
  });

  it("flags a path under `/static/assets/`", () => {
    expect(isBuildArtifact("/proj/app/static/assets/index.css", ".a {}")).toBe(true);
  });

  it("does NOT flag a root-level file literally named `dist.ts`", () => {
    // The marker probe requires `/` on both sides so a file named
    // `dist.ts` or `build.md` at the repo root is not mislabeled.
    expect(isBuildArtifact("/proj/dist.ts", "const x = 1;")).toBe(false);
  });

  it("does NOT flag a source file under `/src/` with no other signals", () => {
    expect(isBuildArtifact("/proj/src/components/Button.tsx", "export const x = 1;")).toBe(false);
  });

  it("normalizes Windows-style backslashes so `\\dist\\` is recognized", () => {
    expect(isBuildArtifact("C:\\proj\\dist\\main.css", ".a {}")).toBe(true);
  });
});

describe("collectBuildArtifacts", () => {
  it("returns the subset of files that match any signal, preserving input order", () => {
    const files = [
      { filePath: "src/Component.tsx", source: "export const x = 1;" },
      { filePath: "app/static/assets/index.css", source: ".w-\\[400px\\] { width: 400px; }" },
      { filePath: "src/styles.css", source: ".card { padding: 1rem; }" },
      { filePath: "dist/main.css", source: "/* compiled */" },
    ];
    expect(collectBuildArtifacts(files)).toEqual(["app/static/assets/index.css", "dist/main.css"]);
  });

  it("returns an empty array when no file matches — callers conditional-spread on this", () => {
    const files = [
      { filePath: "src/Component.tsx", source: "export const x = 1;" },
      { filePath: "src/styles.css", source: ".card { padding: 1rem; }" },
    ];
    expect(collectBuildArtifacts(files)).toEqual([]);
  });

  it("returns an empty array for an empty input batch (honest shape on zero-file scans)", () => {
    expect(collectBuildArtifacts([])).toEqual([]);
  });
});
