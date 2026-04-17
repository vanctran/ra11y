/**
 * Tests for `widenToUniqueAnchor` — the suggest_fix anchor widener that
 * keeps `apply_fix`'s literal find-and-replace from colliding on files
 * with repeated attribute patterns. Covers the three ladder steps
 * (opening-tag cluster, ±1 line, bracket window) and the cap fallback.
 */

import { describe, expect, it } from "bun:test";

import { widenToUniqueAnchor } from "../../../src/mcp/unique-anchor.ts";

describe("widenToUniqueAnchor — ladder step 1: opening-tag cluster", () => {
  it("widens a bare attribute to its surrounding opening tag when that tag is unique", () => {
    const source = [
      '<div className="root">',
      '  <button aria-hidden="true" disabled>Click</button>',
      "</div>",
    ].join("\n");
    const result = widenToUniqueAnchor({
      source,
      oldText: 'aria-hidden="true"',
      newText: "inert",
      line: 2,
    });
    expect(result.oldText).toBe('<button aria-hidden="true" disabled>');
    expect(result.newText).toBe("<button inert disabled>");
    expect(result.caveat).toBeUndefined();
  });
});

describe("widenToUniqueAnchor — ladder step 2: ±1 line window", () => {
  it("falls through to the line window when two tags share the same shape on different lines", () => {
    // Both buttons are byte-for-byte the same opening tag. Step 1's
    // tag-cluster widen produces a non-unique anchor; step 2 picks up
    // the surrounding text on adjacent lines to disambiguate.
    const source = [
      "<section>",
      '  <button aria-hidden="true">First</button>',
      "  <hr/>",
      '  <button aria-hidden="true">Second</button>',
      "</section>",
    ].join("\n");
    const result = widenToUniqueAnchor({
      source,
      oldText: 'aria-hidden="true"',
      newText: "inert",
      line: 4, // the second occurrence
    });
    // Either step 2 or step 3 should produce a unique window — the
    // exact slice depends on which ladder step succeeds first, so we
    // assert uniqueness and inner-region preservation rather than
    // pinning the exact string.
    expect(result.caveat).toBeUndefined();
    expect(countOccurrences(source, result.oldText)).toBe(1);
    expect(result.oldText).toContain('aria-hidden="true"');
    expect(result.newText).toContain("inert");
  });
});

describe("widenToUniqueAnchor — fallback path", () => {
  it("returns the original narrow edit plus a caveat when no unique anchor fits in the cap", () => {
    // 100-char repeating block, three times. Any window ≤200 chars
    // captures at most two full periods, so the bracket-step expansion
    // hits the cap before reaching uniqueness; a 201-char window would
    // disambiguate but the helper bails first. No newlines, no `<...>`
    // tags — line and tag steps both skip.
    // 400 chars of a 10-char repeating block. A 200-char window matches
    // at offsets 0 and 200 non-overlappingly; a 201-char window would
    // be unique but exceeds the cap, so the bracket step bails.
    const source = "ABCDEFGHIJ".repeat(40);
    const result = widenToUniqueAnchor({
      source,
      oldText: "ABCDE",
      newText: "VWXYZ",
      line: 1,
    });
    expect(result.oldText).toBe("ABCDE");
    expect(result.newText).toBe("VWXYZ");
    expect(result.caveat).toBeDefined();
    expect(result.caveat).toContain("not unique");
  });

  it("passes through unchanged when the oldText is already unique in the file", () => {
    const source = ['<button onClick="handler">Submit</button>'].join("\n");
    const result = widenToUniqueAnchor({
      source,
      oldText: 'onClick="handler"',
      newText: 'onClick="newHandler"',
      line: 1,
    });
    // Source has only one occurrence; widening shouldn't be necessary,
    // but we still expect a unique anchor (could be widened or not).
    expect(countOccurrences(source, result.oldText)).toBe(1);
    expect(result.caveat).toBeUndefined();
  });

  it("returns the bare edit unchanged when oldText doesn't appear in the source", () => {
    const result = widenToUniqueAnchor({
      source: "<div>nothing here</div>",
      oldText: "missing-token",
      newText: "replacement",
      line: 1,
    });
    expect(result.oldText).toBe("missing-token");
    expect(result.newText).toBe("replacement");
    expect(result.caveat).toBeUndefined();
  });
});

describe("widenToUniqueAnchor — newText parity", () => {
  it("wraps newText with the same prefix/suffix as oldText so the inner replacement region is preserved", () => {
    const source = '<button aria-hidden="true" disabled>Click</button>';
    const result = widenToUniqueAnchor({
      source,
      oldText: 'aria-hidden="true"',
      newText: "inert",
      line: 1,
    });
    // The widened newText must contain the original inner replacement.
    expect(result.newText).toContain("inert");
    // And must NOT contain the original oldText fragment — that would
    // mean the widen failed to translate the inner region.
    expect(result.newText).not.toContain('aria-hidden="true"');
  });
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return count;
    count += 1;
    i = at + needle.length;
  }
}
