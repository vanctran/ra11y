/**
 * Candidate finder: review/media-variants
 * Criteria: wcag22:1.2.4 (captions, live)
 *           wcag22:1.2.6 (sign language, prerecorded, AAA)
 *           wcag22:1.2.7 (extended audio description, AAA)
 *           wcag22:1.2.8 (media alternative, AAA)
 *           wcag22:1.2.9 (audio-only, live, AAA)
 *           wcag22:1.4.7 (low or no background audio, AAA)
 *
 * Spec:  https://www.w3.org/TR/WCAG22/#captions-live
 *        https://www.w3.org/TR/WCAG22/#sign-language-prerecorded
 *        https://www.w3.org/TR/WCAG22/#extended-audio-description-prerecorded
 *        https://www.w3.org/TR/WCAG22/#media-alternative-prerecorded
 *        https://www.w3.org/TR/WCAG22/#audio-only-live
 *        https://www.w3.org/TR/WCAG22/#low-or-no-background-audio
 *
 * Complements review/media-alternatives (which covers 1.2.1/1.2.3/1.2.5).
 * Every media element is a reviewer's decision point for each of these
 * criteria — static analysis can tell the element exists, but not whether
 * the content is live, prerecorded, speech-only, or has background audio.
 * Per CLAUDE.md §1: surface with a framing reason, don't guess.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { findHtmlElementsByTag, findJsxElementsByTag } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

interface CriterionPrompt {
  readonly criterionId: string;
  readonly equivalentIds: readonly string[];
  readonly videoReason: string | null;
  readonly audioReason: string | null;
}

const PROMPTS: readonly CriterionPrompt[] = [
  {
    criterionId: "wcag22:1.2.4",
    equivalentIds: ["wcag21:1.2.4"],
    videoReason:
      "video element -- if this plays live content, verify synchronized captions are provided",
    audioReason: null,
  },
  {
    criterionId: "wcag22:1.2.6",
    equivalentIds: ["wcag21:1.2.6"],
    videoReason:
      "video element -- if targeting AAA, verify sign-language interpretation is available for prerecorded audio",
    audioReason: null,
  },
  {
    criterionId: "wcag22:1.2.7",
    equivalentIds: ["wcag21:1.2.7"],
    videoReason:
      "video element -- if targeting AAA, verify extended audio description is provided where pauses in foreground audio are insufficient",
    audioReason: null,
  },
  {
    criterionId: "wcag22:1.2.8",
    equivalentIds: ["wcag21:1.2.8"],
    videoReason:
      "video element -- if targeting AAA, verify a full text alternative (transcript) is provided for prerecorded media",
    audioReason:
      "audio element -- if targeting AAA, verify a full text alternative (transcript) is provided for prerecorded media",
  },
  {
    criterionId: "wcag22:1.2.9",
    equivalentIds: ["wcag21:1.2.9"],
    videoReason: null,
    audioReason:
      "audio element -- if this plays live audio-only content, verify an equivalent text alternative is provided",
  },
  {
    criterionId: "wcag22:1.4.7",
    equivalentIds: ["wcag21:1.4.7"],
    videoReason:
      "video element -- if it contains speech, verify any background audio is ≤ 20 dB below the foreground speech or can be muted separately",
    audioReason:
      "audio element -- if it contains speech, verify any background audio is ≤ 20 dB below the foreground speech or can be muted separately",
  },
];

const ALL_CRITERIA: readonly string[] = PROMPTS.flatMap((p) => [p.criterionId, ...p.equivalentIds]);

export const finder = defineCandidateFinder({
  id: "review/media-variants",
  criterionIds: [...ALL_CRITERIA],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds <video> and <audio> elements that need human review for AA/AAA media criteria beyond basic transcripts (live captions, sign language, extended audio description, background audio levels, and live audio-only alternatives).",
    reviewPrompt:
      "At each <video>/<audio> location, determine whether the content is live or prerecorded, audio-only or audiovisual, and contains foreground speech. For live content verify captions (1.2.4) and live-audio alternatives (1.2.9). For prerecorded content verify AAA criteria the project is pursuing (1.2.6 sign language, 1.2.7 extended audio description, 1.2.8 full text alternative). For anything with speech verify background audio levels (1.4.7).",
    references: [
      "https://www.w3.org/TR/WCAG22/#captions-live",
      "https://www.w3.org/TR/WCAG22/#sign-language-prerecorded",
      "https://www.w3.org/TR/WCAG22/#extended-audio-description-prerecorded",
      "https://www.w3.org/TR/WCAG22/#media-alternative-prerecorded",
      "https://www.w3.org/TR/WCAG22/#audio-only-live",
      "https://www.w3.org/TR/WCAG22/#low-or-no-background-audio",
    ],
  },
  find(ctx) {
    const out: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      collectHtml(ctx.ast as HtmlDocument, ctx.filePath, ctx.source, out);
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      collectJsx(ctx.ast as TsxModule, ctx.filePath, ctx.source, out);
    }
    return out;
  },
});

function collectHtml(
  root: HtmlDocument,
  filePath: string,
  source: string,
  out: ReviewCandidate[],
): void {
  for (const el of findHtmlElementsByTag(root, "video"))
    emitHtml(el, "video", filePath, source, out);
  for (const el of findHtmlElementsByTag(root, "audio"))
    emitHtml(el, "audio", filePath, source, out);
}

function collectJsx(
  root: TsxModule,
  filePath: string,
  source: string,
  out: ReviewCandidate[],
): void {
  for (const el of findJsxElementsByTag(root, "video")) emitJsx(el, "video", filePath, source, out);
  for (const el of findJsxElementsByTag(root, "audio")) emitJsx(el, "audio", filePath, source, out);
}

function emitHtml(
  el: HtmlElement,
  kind: "video" | "audio",
  filePath: string,
  source: string,
  out: ReviewCandidate[],
): void {
  const snippet = source.slice(el.range.start, Math.min(el.range.start + 120, el.range.end));
  const location = { filePath, line: el.loc.start.line, column: el.loc.start.column };
  for (const prompt of PROMPTS) {
    const reason = kind === "video" ? prompt.videoReason : prompt.audioReason;
    if (reason === null) continue;
    for (const id of [prompt.criterionId, ...prompt.equivalentIds]) {
      out.push({ criterionId: id, location, reason, snippet });
    }
  }
}

function emitJsx(
  el: JsxElement,
  kind: "video" | "audio",
  filePath: string,
  source: string,
  out: ReviewCandidate[],
): void {
  const snippet = source.slice(el.range.start, Math.min(el.range.start + 120, el.range.end));
  const location = { filePath, line: el.loc.start.line, column: el.loc.start.column };
  for (const prompt of PROMPTS) {
    const reason = kind === "video" ? prompt.videoReason : prompt.audioReason;
    if (reason === null) continue;
    for (const id of [prompt.criterionId, ...prompt.equivalentIds]) {
      out.push({ criterionId: id, location, reason, snippet });
    }
  }
}
