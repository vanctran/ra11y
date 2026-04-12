/**
 * Built-in rules barrel. Every rule ra11y ships out of the box is
 * registered here. v0.1.0 targets ~30 rules covering every "auto"
 * and "partial" criterion under WCAG 2.1 A+AA + WCAG 2.2 A+AA
 * additions.
 */

import type { Rule } from "../types/rule.ts";
import { rule as contrastMinimum } from "./contrast/minimum.ts";
import { rule as langAttribute } from "./document/lang-attribute.ts";
import { rule as pageTitled } from "./document/page-titled.ts";
import { rule as labelsRequired } from "./forms/labels-required.ts";
import { rule as handlerMissing } from "./keyboard/handler-missing.ts";
import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import { rule as linkDescriptiveText } from "./navigation/link-descriptive-text.ts";
import { rule as duplicateId } from "./parsing/duplicate-id.ts";
import { rule as headingHierarchy } from "./semantics/heading-hierarchy.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  altTextMissing,
  contrastMinimum,
  duplicateId,
  handlerMissing,
  headingHierarchy,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  pageTitled,
];

export {
  altTextMissing,
  contrastMinimum,
  duplicateId,
  handlerMissing,
  headingHierarchy,
  labelsRequired,
  langAttribute,
  linkDescriptiveText,
  pageTitled,
};
