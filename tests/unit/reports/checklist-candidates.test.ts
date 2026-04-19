import { describe, expect, it } from "bun:test";
import type { PerStandardCoverage } from "../../../src/reports/coverage.ts";
import { buildChecklist, renderChecklistMarkdown } from "../../../src/reports/index.ts";
import type { ReviewCandidate } from "../../../src/types/review.ts";
import type { Standard } from "../../../src/types/standard.ts";

/**
 * Minimal standard fixture with one manual criterion (1.2.1) and one
 * automatable criterion (1.1.1) so we can test candidate grouping.
 */
const TEST_STANDARD: Standard = {
  id: "wcag22",
  name: "WCAG 2.2",
  version: "2.2",
  publisher: "W3C",
  url: "https://www.w3.org/TR/WCAG22/",
  levels: ["A", "AA", "AAA"],
  criteria: [
    {
      id: "wcag22:1.1.1",
      standardId: "wcag22",
      localId: "1.1.1",
      title: "Non-text Content",
      level: "A",
      description: "All non-text content has a text alternative.",
      url: "https://www.w3.org/TR/WCAG22/#non-text-content",
      automatable: "full",
      equivalentTo: [],
    },
    {
      id: "wcag22:1.2.1",
      standardId: "wcag22",
      localId: "1.2.1",
      title: "Audio-only and Video-only (Prerecorded)",
      level: "A",
      description: "Prerecorded audio/video has a transcript or alternative.",
      url: "https://www.w3.org/TR/WCAG22/#audio-only-and-video-only-prerecorded",
      automatable: "manual",
      equivalentTo: [],
    },
    {
      id: "wcag22:1.2.3",
      standardId: "wcag22",
      localId: "1.2.3",
      title: "Audio Description or Media Alternative (Prerecorded)",
      level: "A",
      description: "Prerecorded video needs audio description.",
      url: "https://www.w3.org/TR/WCAG22/#audio-description-or-media-alternative-prerecorded",
      automatable: "manual",
      equivalentTo: [],
    },
  ],
};

/** Coverage that lists 1.2.1 and 1.2.3 as manual criteria. */
const TEST_COVERAGE: readonly PerStandardCoverage[] = [
  {
    standardId: "wcag22",
    standardName: "WCAG 2.2",
    version: "2.2",
    total: 3,
    automatable: 1,
    manual: 2,
    passing: 1,
    failing: 0,
    failingCriteria: [],
    manualCriteria: ["wcag22:1.2.1", "wcag22:1.2.3"],
    automatedPassRate: 100,
    criteria: [
      { criterionId: "wcag22:1.1.1", static: "pass" },
      { criterionId: "wcag22:1.2.1", static: "manual" },
      { criterionId: "wcag22:1.2.3", static: "manual" },
    ],
  },
];

const STANDARDS: readonly Standard[] = [TEST_STANDARD];

function makeCandidate(
  criterionId: string,
  filePath: string,
  line: number,
  reason: string,
): ReviewCandidate {
  return {
    criterionId,
    location: { filePath, line, column: 1 },
    reason,
    confidence: "medium",
  };
}

describe("buildChecklist with candidates", () => {
  it("produces items with empty candidates when none are provided", () => {
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS);
    for (const section of checklist.sections) {
      for (const item of section.items) {
        expect(item.candidates).toEqual([]);
      }
    }
  });

  it("produces items with empty candidates when an empty array is passed", () => {
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, []);
    for (const section of checklist.sections) {
      for (const item of section.items) {
        expect(item.candidates).toEqual([]);
      }
    }
  });

  it("attaches candidates to the matching criterion", () => {
    const candidates: ReviewCandidate[] = [
      makeCandidate("wcag22:1.2.1", "src/components/VideoPlayer.tsx", 45, "video element"),
      makeCandidate("wcag22:1.2.1", "src/pages/About.tsx", 12, "video element"),
      makeCandidate("wcag22:1.2.1", "src/components/Podcast.tsx", 8, "audio element"),
    ];
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, candidates);
    const section = checklist.sections.find((s) => s.standardId === "wcag22");
    const item121 = section?.items.find((i) => i.id === "wcag22:1.2.1");
    expect(item121?.candidates).toHaveLength(3);
    expect(item121?.candidates[0]?.location.filePath).toBe("src/components/VideoPlayer.tsx");
  });

  it("only attaches candidates to their specific criterion (mixed output)", () => {
    const candidates: ReviewCandidate[] = [
      makeCandidate("wcag22:1.2.1", "src/Video.tsx", 10, "video element"),
      makeCandidate("wcag22:1.2.3", "src/Movie.tsx", 20, "video without description"),
    ];
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, candidates);
    const section = checklist.sections.find((s) => s.standardId === "wcag22");
    const item121 = section?.items.find((i) => i.id === "wcag22:1.2.1");
    const item123 = section?.items.find((i) => i.id === "wcag22:1.2.3");
    expect(item121?.candidates).toHaveLength(1);
    expect(item123?.candidates).toHaveLength(1);
    expect(item121?.candidates[0]?.location.filePath).toBe("src/Video.tsx");
    expect(item123?.candidates[0]?.location.filePath).toBe("src/Movie.tsx");
  });

  it("ignores candidates for non-manual criteria", () => {
    const candidates: ReviewCandidate[] = [
      makeCandidate("wcag22:1.1.1", "src/Img.tsx", 5, "img element"),
    ];
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, candidates);
    // 1.1.1 is automatable, so it doesn't appear in checklist items at all
    const section = checklist.sections.find((s) => s.standardId === "wcag22");
    const item111 = section?.items.find((i) => i.id === "wcag22:1.1.1");
    expect(item111).toBeUndefined();
    // All items should have zero candidates since the only candidate was for 1.1.1
    for (const item of section?.items ?? []) {
      expect(item.candidates).toEqual([]);
    }
  });
});

describe("renderChecklistMarkdown with candidates", () => {
  it("does not show review locations section when no candidates", () => {
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, []);
    const md = renderChecklistMarkdown(checklist);
    expect(md).not.toContain("Review locations");
  });

  it("shows review locations with count for criteria that have candidates", () => {
    const candidates: ReviewCandidate[] = [
      makeCandidate("wcag22:1.2.1", "src/components/VideoPlayer.tsx", 45, "video element"),
      makeCandidate("wcag22:1.2.1", "src/pages/About.tsx", 12, "video element"),
      makeCandidate("wcag22:1.2.1", "src/components/Podcast.tsx", 8, "audio element"),
    ];
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, candidates);
    const md = renderChecklistMarkdown(checklist);
    expect(md).toContain("**Review locations** (3 found):");
    expect(md).toContain("`src/components/VideoPlayer.tsx:45`");
    expect(md).toContain("`src/pages/About.tsx:12`");
    expect(md).toContain("`src/components/Podcast.tsx:8`");
    expect(md).toContain("audio element");
  });

  it("shows review locations only under matching criteria in mixed output", () => {
    const candidates: ReviewCandidate[] = [
      makeCandidate("wcag22:1.2.1", "src/Video.tsx", 10, "video element"),
    ];
    const checklist = buildChecklist(TEST_COVERAGE, STANDARDS, candidates);
    const md = renderChecklistMarkdown(checklist);
    // 1.2.1 has locations
    expect(md).toContain("**Review locations** (1 found):");
    expect(md).toContain("`src/Video.tsx:10`");
    // 1.2.3 does not — count occurrences of "Review locations"
    const matches = md.match(/Review locations/g);
    expect(matches).toHaveLength(1);
  });
});
