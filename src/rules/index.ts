/**
 * Built-in rules barrel. Every rule ra11y ships out of the box is
 * registered here. Phase 6 adds the first rule (media/alt-text-missing);
 * Phases 11+ fill in the full ~30-rule matrix.
 */

import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import type { Rule } from "../types/rule.ts";

export const BUILTIN_RULES: readonly Rule[] = [altTextMissing];

export { altTextMissing };
