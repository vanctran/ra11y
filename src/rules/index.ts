/**
 * Built-in rules barrel. Every rule ra11y ships out of the box is
 * registered here. v0.1.0 targets ~30 rules covering every "auto"
 * and "partial" criterion under WCAG 2.1 A+AA + WCAG 2.2 A+AA
 * additions.
 */

import type { Rule } from "../types/rule.ts";
import { rule as hiddenFocus } from "./aria/hidden-focus.ts";
import { rule as invalidRole } from "./aria/invalid-role.ts";
import { rule as requiredAttrs } from "./aria/required-attrs.ts";
import { rule as validAttr } from "./aria/valid-attr.ts";
import { rule as contrastMinimum } from "./contrast/minimum.ts";
import { rule as iframeTitle } from "./document/iframe-title.ts";
import { rule as langAttribute } from "./document/lang-attribute.ts";
import { rule as metaRefresh } from "./document/meta-refresh.ts";
import { rule as pageTitled } from "./document/page-titled.ts";
import { rule as viewportZoom } from "./document/viewport-zoom.ts";
import { rule as tabindexPositive } from "./focus/tabindex-positive.ts";
import { rule as autocompleteMissing } from "./forms/autocomplete-missing.ts";
import { rule as fieldsetLegend } from "./forms/fieldset-legend.ts";
import { rule as labelForIdMismatch } from "./forms/label-for-id-mismatch.ts";
import { rule as labelsRequired } from "./forms/labels-required.ts";
import { rule as handlerMissing } from "./keyboard/handler-missing.ts";
import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import { rule as autoplaySound } from "./media/autoplay-sound.ts";
import { rule as videoCaptionsMissing } from "./media/video-captions-missing.ts";
import { rule as linkDescriptiveText } from "./navigation/link-descriptive-text.ts";
import { rule as linkNoHref } from "./navigation/link-no-href.ts";
import { rule as duplicateId } from "./parsing/duplicate-id.ts";
import { rule as buttonName } from "./semantics/button-name.ts";
import { rule as headingHierarchy } from "./semantics/heading-hierarchy.ts";
import { rule as listStructure } from "./semantics/list-structure.ts";
import { rule as nestedInteractive } from "./semantics/nested-interactive.ts";
import { rule as tableHeaders } from "./semantics/table-headers.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  altTextMissing,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  contrastMinimum,
  duplicateId,
  fieldsetLegend,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  iframeTitle,
  invalidRole,
  labelForIdMismatch,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  metaRefresh,
  nestedInteractive,
  pageTitled,
  requiredAttrs,
  tabindexPositive,
  tableHeaders,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
];

export {
  altTextMissing,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  contrastMinimum,
  duplicateId,
  fieldsetLegend,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  iframeTitle,
  invalidRole,
  labelForIdMismatch,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  metaRefresh,
  nestedInteractive,
  pageTitled,
  requiredAttrs,
  tabindexPositive,
  tableHeaders,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
};
