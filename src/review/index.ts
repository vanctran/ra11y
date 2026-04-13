/**
 * Built-in candidate finders barrel. Every finder ra11y ships for
 * assisted manual review is registered here.
 */

import type { CandidateFinder } from "../types/review.ts";
import { finder as meaningfulSequence } from "./finders/meaningful-sequence.ts";
import { finder as mediaAlternatives } from "./finders/media-alternatives.ts";
import { finder as noKeyboardTrap } from "./finders/no-keyboard-trap.ts";
import { finder as onInputChange } from "./finders/on-input-change.ts";
import { finder as sensoryCharacteristics } from "./finders/sensory-characteristics.ts";
import { finder as useOfColor } from "./finders/use-of-color.ts";

export const BUILTIN_CANDIDATE_FINDERS: readonly CandidateFinder[] = [
  meaningfulSequence,
  mediaAlternatives,
  noKeyboardTrap,
  onInputChange,
  sensoryCharacteristics,
  useOfColor,
];
