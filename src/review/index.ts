/**
 * Built-in candidate finders barrel. Every finder ra11y ships for
 * assisted manual review is registered here.
 */

import type { CandidateFinder } from "../types/review.ts";
import { finder as captcha } from "./finders/captcha.ts";
import { finder as errorIdentification } from "./finders/error-identification.ts";
import { finder as errorPrevention } from "./finders/error-prevention.ts";
import { finder as errorSuggestion } from "./finders/error-suggestion.ts";
import { finder as imagesOfText } from "./finders/images-of-text.ts";
import { finder as meaningfulSequence } from "./finders/meaningful-sequence.ts";
import { finder as mediaAlternatives } from "./finders/media-alternatives.ts";
import { finder as mediaVariants } from "./finders/media-variants.ts";
import { finder as motionActuation } from "./finders/motion-actuation.ts";
import { finder as multipleWays } from "./finders/multiple-ways.ts";
import { finder as noKeyboardTrap } from "./finders/no-keyboard-trap.ts";
import { finder as onInputChange } from "./finders/on-input-change.ts";
import { finder as redundantEntry } from "./finders/redundant-entry.ts";
import { finder as sectionHeadings } from "./finders/section-headings.ts";
import { finder as sensoryCharacteristics } from "./finders/sensory-characteristics.ts";
import { finder as useOfColor } from "./finders/use-of-color.ts";

export const BUILTIN_CANDIDATE_FINDERS: readonly CandidateFinder[] = [
  captcha,
  errorIdentification,
  errorPrevention,
  errorSuggestion,
  imagesOfText,
  meaningfulSequence,
  mediaAlternatives,
  mediaVariants,
  motionActuation,
  multipleWays,
  noKeyboardTrap,
  onInputChange,
  redundantEntry,
  sectionHeadings,
  sensoryCharacteristics,
  useOfColor,
];
