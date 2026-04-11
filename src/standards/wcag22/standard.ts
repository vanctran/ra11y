/**
 * WCAG 2.2 Standard export — the `defineStandard` call the engine registers.
 *
 * This is the single place the whole wcag22 module exports through. The
 * criteria list is pure data in ./criteria.ts; metadata constants live in
 * ./metadata.ts; both flow together here so consumers can import a single
 * `wcag22` object.
 */

import { defineStandard } from "../../api/plugin.ts";
import { WCAG22_CRITERIA } from "./criteria.ts";
import {
  WCAG22_ID,
  WCAG22_LEVELS,
  WCAG22_NAME,
  WCAG22_PUBLISHER,
  WCAG22_URL,
  WCAG22_VERSION,
} from "./metadata.ts";

export const wcag22 = defineStandard({
  id: WCAG22_ID,
  name: WCAG22_NAME,
  version: WCAG22_VERSION,
  publisher: WCAG22_PUBLISHER,
  url: WCAG22_URL,
  levels: WCAG22_LEVELS,
  criteria: WCAG22_CRITERIA,
});
