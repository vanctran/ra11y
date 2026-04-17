/**
 * Rule: media/video-captions-missing
 * Satisfies: wcag22:1.2.2, wcag21:1.2.2
 * Spec: https://www.w3.org/TR/WCAG22/#captions-prerecorded
 *
 * > Captions are provided for all prerecorded audio content in
 * > synchronized media, except when the media is a media alternative
 * > for text and is clearly labeled as such.
 *
 * Source: https://www.w3.org/TR/WCAG22/#captions-prerecorded
 *
 * Flags `<video>` elements with no child `<track kind="captions">`
 * (or `kind="subtitles"`, which the HTML spec treats as user-facing
 * captions for a different language). Static analysis cannot tell
 * whether a given video is purely decorative; the rule is a warning
 * so teams can suppress it case-by-case via inline disables.
 *
 * Notes:
 *   - The rule does NOT fire on `<video muted>` — muted video still
 *     needs captions if it contains audio content, and the muted
 *     attribute is a display hint, not a semantic one.
 *   - The rule does NOT fire when the video declares
 *     aria-hidden="true" — the whole element is marked as
 *     decorative so captions are moot.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "media/video-captions-missing",
  satisfies: ["wcag22:1.2.2", "wcag21:1.2.2"],
  severity: "warning",
  scope: "node",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<video> elements with audio content need a <track kind='captions'> child so deaf and hard-of-hearing users can follow the dialogue.",
    rationale:
      "Captions are the minimum accessible representation of spoken content in prerecorded video. Without them, deaf users are locked out of the information — and in contexts where sound is off by default (social feeds, waiting rooms, open-plan offices) captions also benefit hearing users.",
    goodExample: `<video src="launch.mp4" controls><track kind="captions" src="launch.vtt" srclang="en" label="English"></video>`,
    badExample: `<video src="launch.mp4" controls></video>`,
    normativeQuote:
      "Captions are provided for all prerecorded audio content in synchronized media.",
    references: [
      "https://www.w3.org/TR/WCAG22/#captions-prerecorded",
      "https://www.w3.org/WAI/media/av/captions/",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const video of findHtmlElementsByTag(doc, "video")) {
    if (getHtmlAttribute(video, "aria-hidden") === "true") continue;
    if (hasCaptionsChildHtml(video)) continue;
    emit(buildViolation("video", video.loc.start));
  }
}

function hasCaptionsChildHtml(video: HtmlElement): boolean {
  for (const child of video.children) {
    if (child.kind !== "HtmlElement") continue;
    if (child.tagName.toLowerCase() !== "track") continue;
    const kind = (getHtmlAttribute(child, "kind") ?? "").toLowerCase();
    if (kind === "captions" || kind === "subtitles") return true;
  }
  return false;
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const video of findJsxElementsByTag(module, "video")) {
    if (getJsxAttributeString(video, "aria-hidden") === "true") continue;
    if (hasCaptionsChildJsx(video)) continue;
    emit(buildViolation("video", video.loc.start));
  }
}

function hasCaptionsChildJsx(video: JsxElement): boolean {
  for (const child of video.children) {
    if (child.kind !== "JsxElement") continue;
    if (child.tagName !== "track") continue;
    const kind = getJsxAttributeString(child, "kind");
    if (kind === "captions" || kind === "subtitles") return true;
  }
  return false;
}

function buildViolation(
  tagName: string,
  loc: { line: number; column: number },
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${tagName}> has no <track kind="captions"> child — deaf and hard-of-hearing users can't follow the dialogue.`,
    suggestion: `Add a captions track: <track kind="captions" src="path/to/captions.vtt" srclang="en" label="English"> inside the <${tagName}>. If the video is decorative (no audio content), mark it with aria-hidden="true" instead.`,
  };
}
