/**
 * Unit tests for the wrapper-name matcher. The matcher backs every
 * wrapper-aware code path — dropWrapperNoise, unusedWrappers detection,
 * source-text search — so the three supported forms (literal, prefix
 * glob, suffix glob, contains glob) need exhaustive coverage.
 */

import { describe, expect, it } from "bun:test";

import {
  isGlobWrapperPattern,
  matchesWrapperPattern,
  nameMatchesAnyWrapper,
  wrapperPatternToTagRegexSource,
} from "../../../src/mcp/wrapper-matcher.ts";

describe("isGlobWrapperPattern", () => {
  it("detects `*` anywhere in the pattern", () => {
    expect(isGlobWrapperPattern("Button")).toBe(false);
    expect(isGlobWrapperPattern("*Button")).toBe(true);
    expect(isGlobWrapperPattern("Button*")).toBe(true);
    expect(isGlobWrapperPattern("*Button*")).toBe(true);
    expect(isGlobWrapperPattern("Icon*Button")).toBe(true);
  });
});

describe("matchesWrapperPattern", () => {
  it("matches literal names exactly", () => {
    expect(matchesWrapperPattern("Button", "Button")).toBe(true);
    expect(matchesWrapperPattern("IconButton", "Button")).toBe(false);
    expect(matchesWrapperPattern("button", "Button")).toBe(false);
  });

  it("suffix glob `*Button` matches anything ending in Button", () => {
    expect(matchesWrapperPattern("Button", "*Button")).toBe(true);
    expect(matchesWrapperPattern("IconButton", "*Button")).toBe(true);
    expect(matchesWrapperPattern("ActionButton", "*Button")).toBe(true);
    expect(matchesWrapperPattern("ButtonGroup", "*Button")).toBe(false);
    expect(matchesWrapperPattern("Submit", "*Button")).toBe(false);
  });

  it("prefix glob `Icon*` matches anything starting with Icon", () => {
    expect(matchesWrapperPattern("Icon", "Icon*")).toBe(true);
    expect(matchesWrapperPattern("IconButton", "Icon*")).toBe(true);
    expect(matchesWrapperPattern("IconImage", "Icon*")).toBe(true);
    expect(matchesWrapperPattern("BigIcon", "Icon*")).toBe(false);
  });

  it("contains glob `*Card*` matches anything with Card inside", () => {
    expect(matchesWrapperPattern("Card", "*Card*")).toBe(true);
    expect(matchesWrapperPattern("ProductCard", "*Card*")).toBe(true);
    expect(matchesWrapperPattern("CardHeader", "*Card*")).toBe(true);
    expect(matchesWrapperPattern("ProductCardHeader", "*Card*")).toBe(true);
    expect(matchesWrapperPattern("Box", "*Card*")).toBe(false);
  });

  it("embedded glob `Icon*Button` matches prefix+suffix pairs", () => {
    expect(matchesWrapperPattern("IconButton", "Icon*Button")).toBe(true);
    expect(matchesWrapperPattern("IconBigButton", "Icon*Button")).toBe(true);
    expect(matchesWrapperPattern("IconDeleteButton", "Icon*Button")).toBe(true);
    expect(matchesWrapperPattern("IconDelete", "Icon*Button")).toBe(false);
    expect(matchesWrapperPattern("BigButton", "Icon*Button")).toBe(false);
  });

  it("does not match across non-identifier characters", () => {
    // Glob `*Button` wildcards expand to [A-Za-z0-9]*, not `.*` — so
    // runtime artifacts like `Foo-Button` or `Foo Button` do not match.
    expect(matchesWrapperPattern("Foo-Button", "*Button")).toBe(false);
    expect(matchesWrapperPattern("Foo Button", "*Button")).toBe(false);
  });
});

describe("nameMatchesAnyWrapper", () => {
  it("returns true on first pattern match", () => {
    expect(nameMatchesAnyWrapper("IconButton", ["Button", "*Button"])).toBe(true);
    expect(nameMatchesAnyWrapper("IconButton", ["*Button"])).toBe(true);
  });

  it("returns false when no pattern matches", () => {
    expect(nameMatchesAnyWrapper("Div", ["Button", "*Button", "Link"])).toBe(false);
    expect(nameMatchesAnyWrapper("Button", [])).toBe(false);
  });
});

describe("matchesWrapperPattern — compound (dotted) names (Q2R2-COMPOUND)", () => {
  it("matches a literal compound wrapper name segment-for-segment", () => {
    expect(matchesWrapperPattern("Card.Header", "Card.Header")).toBe(true);
    expect(matchesWrapperPattern("Card.Body", "Card.Header")).toBe(false);
    // Namespace prefix alone is not a match — literal compares full string.
    expect(matchesWrapperPattern("Card", "Card.Header")).toBe(false);
    expect(matchesWrapperPattern("Card.Header", "Card")).toBe(false);
  });

  it("flat glob `*Header` does NOT cross a namespace dot into `Card.Header`", () => {
    // Identifier-chars wildcard intentionally excludes `.` — keeps flat
    // globs from leaking into compound-component namespaces.
    expect(matchesWrapperPattern("Card.Header", "*Header")).toBe(false);
    expect(matchesWrapperPattern("Card.Header", "Card*")).toBe(false);
  });

  it("namespace-scoped glob `Card.*Section` matches compound subcomponents", () => {
    // Flattened form of `{ Card: { "*Section": "div" } }` — the literal
    // `.` stays literal, the `*` expands within the final segment.
    expect(matchesWrapperPattern("Card.HeaderSection", "Card.*Section")).toBe(true);
    expect(matchesWrapperPattern("Card.FooterSection", "Card.*Section")).toBe(true);
    expect(matchesWrapperPattern("Card.Header", "Card.*Section")).toBe(false);
    // Different namespace does NOT match — the literal `Card.` prefix is required.
    expect(matchesWrapperPattern("Panel.HeaderSection", "Card.*Section")).toBe(false);
  });
});

describe("wrapperPatternToTagRegexSource", () => {
  it("returns an escaped literal for non-glob patterns", () => {
    const source = wrapperPatternToTagRegexSource("Button");
    const re = new RegExp(`<${source}(?=[\\s/>])`);
    expect(re.test("<Button ")).toBe(true);
    expect(re.test("<Buttons ")).toBe(false);
    expect(re.test("<IconButton ")).toBe(false);
  });

  it("expands `*` to an identifier-chars matcher for source-text search", () => {
    const source = wrapperPatternToTagRegexSource("*Button");
    const re = new RegExp(`<${source}(?=[\\s/>])`);
    expect(re.test("<Button ")).toBe(true);
    expect(re.test("<IconButton/")).toBe(true);
    expect(re.test("<ActionButton>")).toBe(true);
    // `<Button` followed by an identifier char is NOT a match — the
    // boundary assertion is the caller's job, but the expansion uses
    // [A-Za-z0-9]* so `ButtonGroup` would only match if the caller's
    // boundary allows. With the `(?=[\s/>])` lookahead we attach here,
    // it correctly rejects `ActionButtonGroup`.
    expect(re.test("<ActionButtonGroup")).toBe(false);
  });
});
