/**
 * Unit tests for the suppression/no-reason finder.
 *
 * The finder flags `ra11y-disable` / `ra11y-disable-next-line` pragmas
 * that skipped the optional `: reason` / `-- reason` suffix. Process
 * rule — not tied to any WCAG SC; the criterion lives in the `ra11y:`
 * namespace and is always active.
 *
 * Tests drive the finder through `runFinder` so the parsing + afterFile
 * hook path matches how the scanner invokes it in production.
 */

import { describe, expect, it } from "bun:test";
import {
  finder,
  SUPPRESSION_NO_REASON_CRITERION,
} from "../../../../src/review/finders/suppression-no-reason.ts";
import { runFinder } from "../../../helpers/run-finder.ts";

describe("suppression/no-reason (positive — should flag bare pragmas)", () => {
  // Guards the canonical JSX pragma form. This is the shape called out
  // in the ra11y MCP tool description — `{/* ra11y-disable ... */}` on
  // a JSX/TSX file — so a bare emission here is the single most common
  // accountability gap.
  it("flags a bare JSX-comment pragma", () => {
    const source = `{/* ra11y-disable wcag22:2.4.6 */}
export function Page() {
  return <h1>Title</h1>;
}`;
    const out = runFinder(finder, source, { filePath: "Page.tsx" });
    expect(out.length).toBe(1);
    expect(out[0]?.criterionId).toBe(SUPPRESSION_NO_REASON_CRITERION);
    expect(out[0]?.reason).toContain("ra11y-disable pragma without reason");
    expect(out[0]?.reason).toContain("wcag22:2.4.6");
    expect(out[0]?.confidence).toBe("medium");
    expect(out[0]?.location.line).toBe(1);
  });

  // Guards the line-comment pragma form. Prevalent in plain TS/JS
  // files that don't use JSX — the finder must not be JSX-only.
  it("flags a bare line-comment pragma in TS source", () => {
    const source = `// ra11y-disable-next-line keyboard/handler-missing
export function handler() {}`;
    const out = runFinder(finder, source, { filePath: "handler.ts" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("keyboard/handler-missing");
    expect(out[0]?.location.line).toBe(1);
  });

  // Guards the HTML comment pragma form. HTML authors use this shape
  // in plain .html files and template fragments; missing it here would
  // leave HTML repos with silent suppressions.
  it("flags a bare HTML-comment pragma", () => {
    const source = `<!-- ra11y-disable media/alt-text-missing -->
<img src="decorative.png">`;
    const out = runFinder(finder, source, { filePath: "page.html" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("media/alt-text-missing");
    expect(out[0]?.location.line).toBe(1);
  });

  // Guards the wildcard-disable case (`ra11y-disable` with no rule/
  // criterion tokens). These blanket silences carry the heaviest
  // accountability cost — surfacing them with specific reason text
  // ("silences all rules") signals the scope to the reviewing agent.
  it("flags a bare wildcard pragma and reports 'silences all rules'", () => {
    const source = `{/* ra11y-disable */}
export default function App() { return null; }`;
    const out = runFinder(finder, source, { filePath: "App.tsx" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("silences all rules");
  });

  // Guards the block-comment form (`/* ... */`) which exists alongside
  // the line-comment `//` form. Covers both TS sources that use
  // `/* */` for mid-line pragmas.
  it("flags a bare block-comment pragma", () => {
    const source = `/* ra11y-disable focus/outline-visible */
export const x = 1;`;
    const out = runFinder(finder, source, { filePath: "x.ts" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("focus/outline-visible");
  });

  // Guards the multi-pragma case: the finder emits one candidate per
  // bare pragma, with no rollup. The AI-first doctrine is explicit —
  // 20 bare pragmas produce 20 candidates; the agent reads and
  // responds per-pragma.
  it("emits one candidate per bare pragma when a file has several", () => {
    const source = `{/* ra11y-disable foo/a */}
{/* ra11y-disable foo/b */}
{/* ra11y-disable-next-line foo/c */}
export const x = 1;`;
    const out = runFinder(finder, source, { filePath: "m.tsx" });
    expect(out.length).toBe(3);
    const lines = out.map((c) => c.location.line).sort((a, b) => a - b);
    expect(lines).toEqual([1, 2, 3]);
  });
});

describe("suppression/no-reason (negative — should NOT flag)", () => {
  // Guards the primary positive-path: a pragma with a colon-separated
  // reason is the documented form the finder is driving toward. Flagging
  // it would punish correct usage and make the finder worse than useless.
  it("does not flag a pragma with a colon-separated reason", () => {
    const source = `{/* ra11y-disable keyboard/handler-missing: wraps a native button internally */}
export function Wrapper() { return null; }`;
    const out = runFinder(finder, source, { filePath: "W.tsx" });
    expect(out).toEqual([]);
  });

  // Guards the `--` separator alternative. Both separators are
  // first-class in the parser; either shape documents the suppression.
  it("does not flag a pragma with a double-dash separated reason", () => {
    const source = `// ra11y-disable-next-line foo/bar -- legacy widget, replacement in flight
export function Legacy() {}`;
    const out = runFinder(finder, source, { filePath: "Legacy.ts" });
    expect(out).toEqual([]);
  });

  // Guards that ordinary comments and prose don't trip the finder.
  // The scan of this test file itself must not flag unrelated text
  // that happens to live near a comment.
  it("does not flag unrelated comments or prose", () => {
    const source = `// This is a regular comment about the module.
/* Another comment — nothing about ra11y. */
<!-- Plain HTML comment -->
export const x = 1;`;
    const out = runFinder(finder, source, { filePath: "x.ts" });
    expect(out).toEqual([]);
  });

  // Guards text that looks like a pragma but isn't inside a comment.
  // The parser only matches comment-bounded pragmas, so a string
  // literal containing `ra11y-disable` must not fire the finder.
  it("does not flag `ra11y-disable` text inside a string literal", () => {
    const source = `export const docs = "Write // ra11y-disable foo/bar: why to suppress.";`;
    const out = runFinder(finder, source, { filePath: "docs.ts" });
    expect(out).toEqual([]);
  });

  // Guards that `ra11y-enable` (which closes a region) is not treated
  // as a suppression requiring a reason. It reopens rules, so the
  // "why did you silence this?" question doesn't apply.
  it("does not flag a bare `ra11y-enable` pragma", () => {
    const source = `// ra11y-disable foo/bar: region closed below
export const x = 1;
// ra11y-enable foo/bar
export const y = 2;`;
    const out = runFinder(finder, source, { filePath: "region.ts" });
    expect(out).toEqual([]);
  });
});

describe("suppression/no-reason (edge cases)", () => {
  // Guards the empty-after-colon edge case. `parseInlineDisablesDetailed`
  // normalizes a colon with no text after it back to `reason: undefined`,
  // so from the finder's perspective the pragma is bare. Documented at
  // the finder's docstring so the behavior is discoverable.
  it("flags a pragma with a colon but no reason text after it", () => {
    const source = `{/* ra11y-disable foo/bar: */}
export const x = 1;`;
    const out = runFinder(finder, source, { filePath: "x.tsx" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("foo/bar");
  });

  // Guards that a criterion-style suppression (`wcag22:2.4.6`) with no
  // reason is still flagged. The colon inside the criterion ID is part
  // of the token, not a reason separator — the parser distinguishes
  // them because the char after `:` in a criterion is always a digit.
  it("flags a bare criterion-ID pragma (colon inside the ID is not a reason separator)", () => {
    const source = `{/* ra11y-disable wcag22:2.4.6 */}
export const x = 1;`;
    const out = runFinder(finder, source, { filePath: "x.tsx" });
    expect(out.length).toBe(1);
    expect(out[0]?.reason).toContain("wcag22:2.4.6");
  });
});
