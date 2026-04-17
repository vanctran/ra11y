/**
 * Unit tests for the `checklist` tool's pagination (Q2-CHECKLIST-LIMIT).
 *
 * Two orthogonal axes are under test:
 *   - limit / offset paginate the flattened candidate stream across
 *     all items; `truncated: true` + `nextOffset` flip on when the
 *     global limit clips the list.
 *   - maxCandidatesPerCriterion clips each item independently;
 *     `perCriterionClipped: true` flips on when any single item was
 *     clipped. Orthogonal to truncation — either, both, or neither
 *     may be set on a response.
 *
 * We exercise the pure helpers directly (rather than through an MCP
 * subprocess) so the contract is testable without staging fixtures
 * that coincidentally happen to produce N candidates.
 */
import { describe, expect, it } from "bun:test";
import {
  type ChecklistPageParams,
  paginateChecklistItems,
  readChecklistPageParams,
} from "../../../src/mcp/tool-checklist.ts";
import type { ReviewConfidence } from "../../../src/types/review.ts";

/**
 * Builds a synthetic item shaped like the real `ChecklistItemOut`,
 * carrying `candidateCount` candidates with unique paths so slicing
 * is observable.
 */
function makeItem(
  criterionId: string,
  candidateCount: number,
  confidence: ReviewConfidence = "medium",
) {
  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    path: `${criterionId}-${i}.tsx`,
    line: i + 1,
    reason: "manual review candidate",
    confidence,
  }));
  return {
    criterionId,
    title: `Criterion ${criterionId}`,
    level: "AA",
    priority: "high" as const,
    confidence,
    candidates,
  };
}

/**
 * Builds a flat list of N items each carrying exactly one candidate,
 * for testing global limit/offset across items.
 */
function singleCandidateItems(n: number) {
  return Array.from({ length: n }, (_, i) => makeItem(`wcag22:1.${i}.${i}`, 1));
}

const fullParams = (partial: Partial<ChecklistPageParams> = {}): ChecklistPageParams => ({
  limit: partial.limit ?? 200,
  offset: partial.offset ?? 0,
  maxCandidatesPerCriterion: partial.maxCandidatesPerCriterion ?? 10,
});

describe("readChecklistPageParams", () => {
  it("returns defaults when no params supplied", () => {
    expect(readChecklistPageParams({})).toEqual({
      limit: 200,
      offset: 0,
      maxCandidatesPerCriterion: 10,
    });
  });

  it("clamps limit up to the min when given zero or negative", () => {
    expect(readChecklistPageParams({ limit: 0 }).limit).toBe(1);
    expect(readChecklistPageParams({ limit: -5 }).limit).toBe(1);
  });

  it("clamps limit down to the max when given a huge value", () => {
    expect(readChecklistPageParams({ limit: 3000 }).limit).toBe(2000);
    expect(readChecklistPageParams({ limit: 999999 }).limit).toBe(2000);
  });

  it("clamps maxCandidatesPerCriterion to [1, 100]", () => {
    expect(
      readChecklistPageParams({ maxCandidatesPerCriterion: 0 }).maxCandidatesPerCriterion,
    ).toBe(1);
    expect(
      readChecklistPageParams({ maxCandidatesPerCriterion: 500 }).maxCandidatesPerCriterion,
    ).toBe(100);
  });

  it("floors fractional values", () => {
    const got = readChecklistPageParams({
      limit: 42.9,
      offset: 5.7,
      maxCandidatesPerCriterion: 8.4,
    });
    expect(got).toEqual({ limit: 42, offset: 5, maxCandidatesPerCriterion: 8 });
  });

  it("falls back to defaults on non-numeric input", () => {
    const got = readChecklistPageParams({
      limit: "200",
      offset: null,
      maxCandidatesPerCriterion: "10",
    });
    expect(got).toEqual({ limit: 200, offset: 0, maxCandidatesPerCriterion: 10 });
  });

  it("clamps negative offset to 0", () => {
    expect(readChecklistPageParams({ offset: -10 }).offset).toBe(0);
  });
});

describe("paginateChecklistItems — limit / offset axis", () => {
  it("returns everything with no pagination fields when the inventory fits", () => {
    const items = singleCandidateItems(50);
    const page = paginateChecklistItems(items, fullParams({ limit: 200 }));
    expect(page.items.length).toBe(50);
    expect(page.totalCandidates).toBe(50);
    // Honest-shape: fields absent, not `truncated: false`.
    expect(page.paginationFields.truncated).toBeUndefined();
    expect(page.paginationFields.nextOffset).toBeUndefined();
    expect(page.paginationFields.perCriterionClipped).toBeUndefined();
  });

  it("emits truncated + nextOffset when the global cap clips the list", () => {
    const items = singleCandidateItems(50);
    const page = paginateChecklistItems(items, fullParams({ limit: 10 }));
    expect(page.items.length).toBe(10);
    expect(page.totalCandidates).toBe(50);
    expect(page.paginationFields.truncated).toBe(true);
    expect(page.paginationFields.nextOffset).toBe(10);
    expect(page.paginationFields.perCriterionClipped).toBeUndefined();
  });

  it("drops truncated on the last page and preserves totalCandidates", () => {
    const items = singleCandidateItems(50);
    const page = paginateChecklistItems(items, fullParams({ limit: 10, offset: 40 }));
    expect(page.items.length).toBe(10);
    expect(page.totalCandidates).toBe(50);
    // Last page — no more to fetch, so truncated/nextOffset omitted.
    expect(page.paginationFields.truncated).toBeUndefined();
    expect(page.paginationFields.nextOffset).toBeUndefined();
  });

  it("works fine at the max-limit boundary (no off-by-one clamp fail)", () => {
    const items = singleCandidateItems(50);
    const page = paginateChecklistItems(items, fullParams({ limit: 2000 }));
    expect(page.items.length).toBe(50);
    expect(page.paginationFields.truncated).toBeUndefined();
  });

  it("paginates mid-item boundaries across a multi-candidate criterion", () => {
    // One item with 30 candidates (post-clip we'll set max=100 so no
    // per-criterion clipping kicks in), limit=5, offset=10 → middle 5.
    const items = [makeItem("wcag22:2.4.5", 30)];
    const page = paginateChecklistItems(
      items,
      fullParams({ limit: 5, offset: 10, maxCandidatesPerCriterion: 100 }),
    );
    expect(page.items.length).toBe(1);
    expect(page.items[0].candidates.length).toBe(5);
    expect(page.items[0].candidates[0].path).toBe("wcag22:2.4.5-10.tsx");
    expect(page.items[0].candidates[4].path).toBe("wcag22:2.4.5-14.tsx");
    expect(page.paginationFields.truncated).toBe(true);
    expect(page.paginationFields.nextOffset).toBe(15);
  });
});

describe("paginateChecklistItems — maxCandidatesPerCriterion axis", () => {
  it("clips a noisy criterion and flags perCriterionClipped", () => {
    // One criterion with 30 candidates, capped at 5.
    const items = [makeItem("wcag22:2.4.5", 30)];
    const page = paginateChecklistItems(items, fullParams({ maxCandidatesPerCriterion: 5 }));
    expect(page.items.length).toBe(1);
    expect(page.items[0].candidates.length).toBe(5);
    // totalCandidates reports the pre-clip count so the agent can see
    // how much was elided.
    expect(page.totalCandidates).toBe(30);
    expect(page.paginationFields.perCriterionClipped).toBe(true);
    // Per-criterion clip does NOT trigger `truncated` — that's the
    // different axis. (Here post-clip total is 5 which fits in 200.)
    expect(page.paginationFields.truncated).toBeUndefined();
    expect(page.paginationFields.nextOffset).toBeUndefined();
  });

  it("leaves perCriterionClipped absent when no item exceeds the cap", () => {
    const items = [makeItem("wcag22:1.4.3", 3), makeItem("wcag22:2.4.5", 5)];
    const page = paginateChecklistItems(items, fullParams({ maxCandidatesPerCriterion: 10 }));
    expect(page.paginationFields.perCriterionClipped).toBeUndefined();
    expect(page.totalCandidates).toBe(8);
  });

  it("perCriterionClipped and truncated are orthogonal — can coexist", () => {
    // 3 items, each with 30 candidates, cap 5 → post-clip 15 total.
    // Limit 10 → page has 10, 5 remain, truncated=true.
    const items = [
      makeItem("wcag22:1.4.3", 30),
      makeItem("wcag22:2.4.5", 30),
      makeItem("wcag22:3.3.1", 30),
    ];
    const page = paginateChecklistItems(
      items,
      fullParams({ limit: 10, maxCandidatesPerCriterion: 5 }),
    );
    expect(page.paginationFields.perCriterionClipped).toBe(true);
    expect(page.paginationFields.truncated).toBe(true);
    expect(page.paginationFields.nextOffset).toBe(10);
    // Pre-clip total is 90; totalCandidates reports that.
    expect(page.totalCandidates).toBe(90);
  });

  it("drops items entirely outside the offset window", () => {
    // 3 items x 5 candidates each post-clip; offset=7, limit=3 →
    // spans the end of item[1] (one candidate) + start of item[2]
    // (two candidates). item[0] is entirely skipped.
    const items = [
      makeItem("wcag22:1.4.3", 5),
      makeItem("wcag22:2.4.5", 5),
      makeItem("wcag22:3.3.1", 5),
    ];
    const page = paginateChecklistItems(
      items,
      fullParams({ limit: 3, offset: 7, maxCandidatesPerCriterion: 10 }),
    );
    // item[0] (indices 0..4) dropped.
    // item[1] (5..9): candidates 7, 8, 9 would be in range — but
    // limit=3 caps at index 9, so slice is 7..9 = 3 candidates.
    expect(page.items.length).toBe(1);
    expect(page.items[0].criterionId).toBe("wcag22:2.4.5");
    expect(page.items[0].candidates.length).toBe(3);
    expect(page.items[0].candidates[0].path).toBe("wcag22:2.4.5-2.tsx");
    expect(page.paginationFields.truncated).toBe(true);
    expect(page.paginationFields.nextOffset).toBe(10);
  });

  it("empty inventory yields empty page with no pagination fields", () => {
    const page = paginateChecklistItems([], fullParams());
    expect(page.items).toEqual([]);
    expect(page.totalCandidates).toBe(0);
    expect(page.paginationFields.truncated).toBeUndefined();
    expect(page.paginationFields.perCriterionClipped).toBeUndefined();
  });
});

describe("paginateChecklistItems — end-to-end via readChecklistPageParams", () => {
  it("clamped inputs flow through: limit:0 → 1-item truncated page; limit:3000 clamps to 2000", () => {
    const items = singleCandidateItems(50);
    const pageLow = paginateChecklistItems(items, readChecklistPageParams({ limit: 0 }));
    // limit clamps to 1 → 1 item returned, truncated=true.
    expect(pageLow.items.length).toBe(1);
    expect(pageLow.paginationFields.truncated).toBe(true);
    expect(pageLow.paginationFields.nextOffset).toBe(1);
    // 3000 clamps to 2000, comfortably fits 50 items → no truncation.
    const pageHigh = paginateChecklistItems(items, readChecklistPageParams({ limit: 3000 }));
    expect(pageHigh.items.length).toBe(50);
    expect(pageHigh.paginationFields.truncated).toBeUndefined();
  });
});
