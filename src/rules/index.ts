/**
 * Built-in rules barrel. Every rule ra11y ships out of the box is
 * registered here. v0.1.0 ships 36 rules covering the auto/partial
 * criteria under WCAG 2.1 A+AA + WCAG 2.2 A+AA additions.
 */

import type { Rule } from "../types/rule.ts";
import { rule as hiddenFocus } from "./aria/hidden-focus.ts";
import { rule as invalidRole } from "./aria/invalid-role.ts";
import { rule as liveRegionValid } from "./aria/live-region-valid.ts";
import { rule as requiredAttrs } from "./aria/required-attrs.ts";
import { rule as validAttr } from "./aria/valid-attr.ts";
import { rule as contrastEnhanced } from "./contrast/enhanced.ts";
import { rule as contrastMinimum } from "./contrast/minimum.ts";
import { rule as contrastNonText } from "./contrast/non-text.ts";
import { rule as iframeTitle } from "./document/iframe-title.ts";
import { rule as langAttribute } from "./document/lang-attribute.ts";
import { rule as metaRefresh } from "./document/meta-refresh.ts";
import { rule as pageTitled } from "./document/page-titled.ts";
import { rule as viewportZoom } from "./document/viewport-zoom.ts";
import { rule as notObscured } from "./focus/not-obscured.ts";
import { rule as outlineVisible } from "./focus/outline-visible.ts";
import { rule as tabindexPositive } from "./focus/tabindex-positive.ts";
import { rule as autocompleteMissing } from "./forms/autocomplete-missing.ts";
import { rule as fieldsetLegend } from "./forms/fieldset-legend.ts";
import { rule as labelForIdMismatch } from "./forms/label-for-id-mismatch.ts";
import { rule as labelsRequired } from "./forms/labels-required.ts";
import { rule as nonEmptyLabel } from "./forms/non-empty-label.ts";
import { rule as accesskeyDuplicate } from "./keyboard/accesskey-duplicate.ts";
import { rule as characterShortcuts } from "./keyboard/character-shortcuts.ts";
import { rule as handlerMissing } from "./keyboard/handler-missing.ts";
import { rule as orientationLock } from "./layout/orientation-lock.ts";
import { rule as reflowHardcodedWidth } from "./layout/reflow-hardcoded-width.ts";
import { rule as textSpacing } from "./layout/text-spacing.ts";
import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import { rule as autoplaySound } from "./media/autoplay-sound.ts";
import { rule as videoCaptionsMissing } from "./media/video-captions-missing.ts";
import { rule as pauseStopHide } from "./motion/pause-stop-hide.ts";
import { rule as linkDescriptiveText } from "./navigation/link-descriptive-text.ts";
import { rule as linkNoHref } from "./navigation/link-no-href.ts";
import { rule as skipLink } from "./navigation/skip-link.ts";
import { rule as duplicateId } from "./parsing/duplicate-id.ts";
import { rule as htmlHasLang } from "./parsing/html-has-lang.ts";
import { rule as cancellation } from "./pointer/cancellation.ts";
import { rule as buttonName } from "./semantics/button-name.ts";
import { rule as emptyHeading } from "./semantics/empty-heading.ts";
import { rule as headingHierarchy } from "./semantics/heading-hierarchy.ts";
import { rule as labelInName } from "./semantics/label-in-name.ts";
import { rule as landmarkMain } from "./semantics/landmark-main.ts";
import { rule as listStructure } from "./semantics/list-structure.ts";
import { rule as nestedInteractive } from "./semantics/nested-interactive.ts";
import { rule as tableHeaders } from "./semantics/table-headers.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  accesskeyDuplicate,
  altTextMissing,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  cancellation,
  characterShortcuts,
  contrastEnhanced,
  contrastMinimum,
  contrastNonText,
  duplicateId,
  emptyHeading,
  fieldsetLegend,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  htmlHasLang,
  iframeTitle,
  invalidRole,
  labelForIdMismatch,
  labelInName,
  labelsRequired,
  landmarkMain,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  liveRegionValid,
  metaRefresh,
  nestedInteractive,
  nonEmptyLabel,
  notObscured,
  orientationLock,
  outlineVisible,
  pageTitled,
  pauseStopHide,
  reflowHardcodedWidth,
  requiredAttrs,
  skipLink,
  tabindexPositive,
  tableHeaders,
  textSpacing,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
];

export {
  accesskeyDuplicate,
  altTextMissing,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  cancellation,
  characterShortcuts,
  contrastEnhanced,
  contrastMinimum,
  contrastNonText,
  duplicateId,
  emptyHeading,
  fieldsetLegend,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  htmlHasLang,
  iframeTitle,
  invalidRole,
  labelForIdMismatch,
  labelInName,
  labelsRequired,
  landmarkMain,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  liveRegionValid,
  metaRefresh,
  nestedInteractive,
  nonEmptyLabel,
  notObscured,
  orientationLock,
  outlineVisible,
  pageTitled,
  pauseStopHide,
  reflowHardcodedWidth,
  requiredAttrs,
  skipLink,
  tabindexPositive,
  tableHeaders,
  textSpacing,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
};
