/**
 * Fuzz tests for the CSS parser. Same contract as the HTML fuzz
 * suite — on arbitrary input, the parser returns a result (maybe
 * with errors) in bounded time and does not throw.
 */

import { describe, expect, it } from "bun:test";
import { parseCss } from "../../../../src/input/parsers/css.ts";

function makeRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const CSS_ALPHABET = [
  ".foo { ",
  "#bar { ",
  "@media (min-width: 500px) { ",
  "@keyframes x {",
  "@supports (color: red) {",
  "color: red;",
  "background: url(foo.png);",
  "width: 100px;",
  "height: calc(100% - 20px);",
  "border: 1px solid var(--c);",
  "font-family: 'Helvetica', sans-serif;",
  'content: "hello\\"world";',
  "/* ",
  " */",
  "}",
  " ",
  "\n",
  "\t",
  "a:hover { ",
  "body > :not(.x) {",
  "margin: 0 auto;",
  ":root { --x: #fff; }",
  "/* unterminated  ",
  'url("',
  "'",
];

function synthesize(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng() * CSS_ALPHABET.length);
    out += CSS_ALPHABET[idx];
  }
  return out;
}

const TIMEOUT_MS = 2000;
const SIZES = [32, 256, 1024, 4096];
const SEEDS = [1, 42, 0xdeadbeef, 12345, 98765];

describe("css parser — fuzz", () => {
  for (const seed of SEEDS) {
    for (const size of SIZES) {
      it(`survives random input seed=${seed} size=${size}`, () => {
        const rng = makeRng(seed);
        const src = synthesize(rng, size);
        const start = Date.now();
        const result = parseCss(src);
        expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
        expect(result.root).toBeDefined();
      });
    }
  }

  it("survives an unterminated comment at the end", () => {
    const src = `/* ${"x".repeat(10_000)}`;
    const start = Date.now();
    const result = parseCss(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });

  it("survives many nested at-rules", () => {
    const src = `${"@media screen {".repeat(200)}${"}".repeat(200)}`;
    const start = Date.now();
    const result = parseCss(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });

  it("guards the O(n²) position regression on a 100k-byte input", () => {
    const src = `${".a { color: red; }\n".repeat(5_000)}`;
    const start = Date.now();
    const result = parseCss(src);
    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    expect(result.root).toBeDefined();
  });
});
