/**
 * Rule: media/autoplay-sound
 * Satisfies: wcag22:1.4.2, wcag21:1.4.2
 * Spec: https://www.w3.org/TR/WCAG22/#audio-control
 *
 * > If any audio on a Web page plays automatically for more than 3
 * > seconds, either a mechanism is available to pause or stop the
 * > audio, or a mechanism is available to control audio volume
 * > independently from the overall system volume level.
 *
 * Source: https://www.w3.org/TR/WCAG22/#audio-control
 *
 * Flags `<audio autoplay>` and `<video autoplay>` that start playing
 * sound the moment the page loads with no user-facing mechanism to
 * stop them. Two escape hatches make the media compliant:
 *
 *   - `muted` — the element plays silently, so there is no audio to
 *     stop. Common and legitimate for hero/background video.
 *   - `controls` — the native media UI (play/pause, volume) gives
 *     the user a mechanism to stop the audio on demand, satisfying
 *     the second clause of the normative text.
 *
 * Only the combination `autoplay` present AND `muted` absent AND
 * `controls` absent is flagged. HTML boolean attributes are treated
 * as present regardless of value (`autoplay`, `autoplay=""`,
 * `autoplay="autoplay"` all mean "yes"). In JSX, an explicit
 * `={false}` expression counts as absent; any other expression value
 * is conservatively treated as present to avoid a false-positive
 * avalanche on dynamic props (this is the same tradeoff the
 * eslint-plugin-jsx-a11y rules make).
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getJsxAttribute,
  hasHtmlAttribute,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "media/autoplay-sound",
  satisfies: ["wcag22:1.4.2", "wcag21:1.4.2"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<audio> and <video> that autoplay with sound must give the user a mechanism to stop or mute them — either the native controls UI or a muted attribute.",
    rationale:
      "Audio that starts unexpectedly is disorienting for screen reader users (it competes with the synthesized voice they rely on) and hostile to anyone browsing in a shared space. WCAG 1.4.2 requires a mechanism to pause, stop, or independently control the volume of any audio that plays for more than 3 seconds.",
    goodExample: `<video autoplay muted loop><source src="hero.mp4" type="video/mp4"></video>`,
    badExample: `<audio autoplay src="bgm.mp3"></audio>`,
    normativeQuote:
      "If any audio on a Web page plays automatically for more than 3 seconds, either a mechanism is available to pause or stop the audio, or a mechanism is available to control audio volume independently from the overall system volume level.",
    references: [
      "https://www.w3.org/TR/WCAG22/#audio-control",
      "https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
      return;
    }
    if (
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
  for (const tagName of ["audio", "video"] as const) {
    for (const element of findHtmlElementsByTag(doc, tagName)) {
      if (!hasHtmlAttribute(element, "autoplay")) continue;
      if (hasHtmlAttribute(element, "muted")) continue;
      if (hasHtmlAttribute(element, "controls")) continue;
      emitViolation(tagName, element.loc.start, emit);
    }
  }
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const tagName of ["audio", "video"] as const) {
    for (const element of findJsxElementsByTag(module, tagName)) {
      if (!hasTruthyJsxAttribute(element, "autoplay")) continue;
      if (hasTruthyJsxAttribute(element, "muted")) continue;
      if (hasTruthyJsxAttribute(element, "controls")) continue;
      emitViolation(tagName, element.loc.start, emit);
    }
  }
}

/**
 * True if the JSX element has the attribute and the value is not an
 * explicit `{false}` / `{null} / {undefined}` expression.
 *
 * JSX reference:
 *   - `<audio autoplay />`            → value: null (shorthand truthy)
 *   - `<audio autoplay="autoplay" />` → StringLiteral "autoplay" (truthy)
 *   - `<audio autoPlay={true} />`     → Expression "{true}" (truthy)
 *   - `<audio autoPlay={false} />`    → Expression "{false}" (falsy)
 *   - `<audio autoPlay={shouldPlay}/>`→ Expression "{shouldPlay}" (conservative: truthy)
 */
function hasTruthyJsxAttribute(element: JsxElement, name: string): boolean {
  const attr = getJsxAttribute(element, name);
  if (attr === null) return false;
  const value = attr.value;
  if (value === null) return true; // shorthand: <audio autoplay />
  if (value.kind === "StringLiteral") return true;
  const raw = value.raw.replace(/\s+/g, "");
  if (raw === "{false}" || raw === "{null}" || raw === "{undefined}") return false;
  return true;
}

function emitViolation(
  tagName: "audio" | "video",
  loc: { line: number; column: number },
  emit: Emit,
): void {
  emit({
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: buildMessage(tagName),
    suggestion: buildSuggestion(tagName),
  });
}

function buildMessage(tagName: "audio" | "video"): string {
  if (tagName === "audio") {
    return `<audio autoplay> starts playing sound immediately with no user mechanism to stop it — disorienting for screen reader users and anyone in a shared space.`;
  }
  return `<video autoplay> starts playing with sound and no user mechanism to stop it — audio that autoplays for more than 3 seconds violates WCAG 1.4.2.`;
}

function buildSuggestion(tagName: "audio" | "video"): string {
  if (tagName === "audio") {
    return `Either add the native controls UI (\`<audio autoplay controls>\`) so the user can pause, or add \`muted\` if the audio is not essential. Best practice: drop \`autoplay\` entirely and let the user start playback.`;
  }
  return `Background/hero videos should be \`<video autoplay muted loop>\` — muted video has no audio to control. If the video needs sound, add \`controls\` so the user can pause, or remove \`autoplay\` and let them press play.`;
}
