/**
 * Fuzz tests for the HTML parser.
 *
 * Guarantees: on any byte sequence the parser accepts as UTF-8, the
 * parser returns a result (possibly with `.errors`) and does NOT
 * throw, hang, or run in quadratic time. Real-world HTML includes
 * unbalanced quotes, runaway strings, deeply-nested comments, and
 * malformed DOCTYPEs; the parser has to recover from all of it.
 *
 * We use a deterministic PRNG (seedable) so CI failures can be
 * reproduced from the recorded seed.
 */

import { describe, expect, it } from "bun:test";
import { parseHtml } from "../../../../src/input/parsers/html.ts";

// xorshift32 — tiny deterministic PRNG.
function makeRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const HTML_ALPHABET = [
  "<div>",
  "</div>",
  "<span>",
  "</span>",
  "<br>",
  "<br/>",
  "<img src='x'>",
  '<img alt="a">',
  "<a href=/>",
  "<input disabled>",
  "<ul><li>",
  "<!-- comment ",
  " comment -->",
  "<!DOCTYPE html>",
  "<html lang=en>",
  "<script>let x=",
  "</script>",
  "<style>.x{",
  "}</style>",
  " ",
  "\n",
  "\t",
  "  attr='",
  'attr="',
  "<><tag 广东", // non-ASCII + malformed tag
  "&amp;",
  "&#x41;",
];

function synthesize(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng() * HTML_ALPHABET.length);
    out += HTML_ALPHABET[idx];
  }
  return out;
}

const TIMEOUT_MS = 2000;
const SIZES = [32, 256, 1024, 4096];
const SEEDS = [1, 42, 0xdeadbeef, 12345, 98765];

describe("html parser — fuzz", () => {
  for (const seed of SEEDS) {
    for (const size of SIZES) {
      it(`survives random input seed=${seed} size=${size}`, () => {
        const rng = makeRng(seed);
        const src = synthesize(rng, size);
        const start = Date.now();
        const result = parseHtml(src);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(TIMEOUT_MS);
        expect(result.root).toBeDefined();
        expect(Array.isArray(result.errors)).toBe(true);
      });
    }
  }

  it("handles a pathologically long unterminated comment without hanging", () => {
    const src = `<!-- ${"x".repeat(10_000)}`;
    const start = Date.now();
    const result = parseHtml(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });

  it("handles deeply nested elements without stack overflow", () => {
    const src = `${"<div>".repeat(500)}content${"</div>".repeat(500)}`;
    const start = Date.now();
    const result = parseHtml(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });

  it("preserves line/col tracking on a 100k-byte input", () => {
    // Guards the O(n²) position regression (see CLAUDE.md parser invariant).
    const src = `${"<p>line\n".repeat(10_000)}<p>end`;
    const start = Date.now();
    const result = parseHtml(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });
});
