/**
 * WCAG 2.1 Standard export.
 */

import { defineStandard } from "../../api/plugin.ts";
import { WCAG21_CRITERIA } from "./criteria.ts";
import {
  WCAG21_ID,
  WCAG21_LEVELS,
  WCAG21_NAME,
  WCAG21_PUBLISHER,
  WCAG21_URL,
  WCAG21_VERSION,
} from "./metadata.ts";

export const wcag21 = defineStandard({
  id: WCAG21_ID,
  name: WCAG21_NAME,
  version: WCAG21_VERSION,
  publisher: WCAG21_PUBLISHER,
  url: WCAG21_URL,
  levels: WCAG21_LEVELS,
  criteria: WCAG21_CRITERIA,
});
