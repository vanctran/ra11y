/**
 * Candidate finder: review/media-alternatives
 * Criteria: wcag22:1.2.1, wcag21:1.2.1, wcag22:1.2.3, wcag21:1.2.3,
 *           wcag22:1.2.5, wcag21:1.2.5
 * Spec: https://www.w3.org/TR/WCAG22/#audio-only-and-video-only-prerecorded
 *       https://www.w3.org/TR/WCAG22/#audio-description-or-media-alternative-prerecorded
 *       https://www.w3.org/TR/WCAG22/#audio-description-prerecorded
 *
 * Finds <video>, <audio>, and <iframe> elements that need human review
 * to verify transcripts, captions, and audio descriptions are provided.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { findHtmlElementsByTag, findJsxElementsByTag } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:1.2.1",
  "wcag21:1.2.1",
  "wcag22:1.2.3",
  "wcag21:1.2.3",
  "wcag22:1.2.5",
  "wcag21:1.2.5",
] as const;

const MEDIA_TAGS = ["video", "audio", "iframe"] as const;

function reasonForTag(tag: (typeof MEDIA_TAGS)[number]): string {
  switch (tag) {
    case "video":
      return "video element -- verify transcript or audio description is provided";
    case "audio":
      return "audio element -- verify transcript is provided";
    case "iframe":
      return "iframe element -- verify embedded media has accessible alternatives";
  }
}

export const finder = defineCandidateFinder({
  id: "review/media-alternatives",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds media elements (<video>, <audio>, <iframe>) that need human review for transcripts, captions, and audio descriptions.",
    reviewPrompt:
      "Verify that prerecorded audio has a transcript, prerecorded video has captions and an audio description or full text alternative, and iframes with media content have accessible alternatives.",
    references: [
      "https://www.w3.org/TR/WCAG22/#audio-only-and-video-only-prerecorded",
      "https://www.w3.org/TR/WCAG22/#audio-description-or-media-alternative-prerecorded",
      "https://www.w3.org/TR/WCAG22/#audio-description-prerecorded",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html")
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, ctx.source, candidates);
    else if (ctx.language === "tsx" || ctx.language === "jsx")
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, ctx.source, candidates);
    return candidates;
  },
});

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  source: string,
  candidates: ReviewCandidate[],
): void {
  for (const tag of MEDIA_TAGS) {
    for (const el of findHtmlElementsByTag(root, tag)) {
      for (const criterionId of CRITERION_IDS) {
        // Confidence "high": deterministic tag match on <video>,
        // <audio>, <iframe>. The reviewer question is about
        // transcripts/captions/alternatives — the element is
        // unambiguous.
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: reasonForTag(tag),
          snippet: source.slice(el.range.start, Math.min(el.range.start + 120, el.range.end)),
          confidence: "high",
        });
      }
    }
  }
}

function findJsxCandidates(
  root: TsxModule,
  filePath: string,
  source: string,
  candidates: ReviewCandidate[],
): void {
  for (const tag of MEDIA_TAGS) {
    for (const el of findJsxElementsByTag(root, tag)) {
      for (const criterionId of CRITERION_IDS) {
        // Confidence "high": deterministic tag match on <video>,
        // <audio>, <iframe>. The reviewer question is about
        // transcripts/captions/alternatives — the element is
        // unambiguous.
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: reasonForTag(tag),
          snippet: source.slice(el.range.start, Math.min(el.range.start + 120, el.range.end)),
          confidence: "high",
        });
      }
    }
  }
}
