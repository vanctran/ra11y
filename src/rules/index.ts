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
import { rule as langAttribute } from "./document/lang-attribute.ts";
import { rule as pageTitled } from "./document/page-titled.ts";
import { rule as viewportZoom } from "./document/viewport-zoom.ts";
import { rule as tabindexPositive } from "./focus/tabindex-positive.ts";
import { rule as autocompleteMissing } from "./forms/autocomplete-missing.ts";
import { rule as labelsRequired } from "./forms/labels-required.ts";
import { rule as handlerMissing } from "./keyboard/handler-missing.ts";
import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import { rule as videoCaptionsMissing } from "./media/video-captions-missing.ts";
import { rule as linkDescriptiveText } from "./navigation/link-descriptive-text.ts";
import { rule as linkNoHref } from "./navigation/link-no-href.ts";
import { rule as duplicateId } from "./parsing/duplicate-id.ts";
import { rule as buttonName } from "./semantics/button-name.ts";
import { rule as headingHierarchy } from "./semantics/heading-hierarchy.ts";
import { rule as listStructure } from "./semantics/list-structure.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  altTextMissing,
  autocompleteMissing,
  buttonName,
  contrastMinimum,
  duplicateId,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  invalidRole,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  pageTitled,
  requiredAttrs,
  tabindexPositive,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
];

export {
  altTextMissing,
  autocompleteMissing,
  buttonName,
  contrastMinimum,
  duplicateId,
  handlerMissing,
  headingHierarchy,
  hiddenFocus,
  invalidRole,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  linkNoHref,
  listStructure,
  pageTitled,
  requiredAttrs,
  tabindexPositive,
  validAttr,
  videoCaptionsMissing,
  viewportZoom,
};
