/**
 * Section 508 (2017 refresh) Standard export.
 */

import { defineStandard } from "../../api/plugin.ts";
import { SECTION508_CRITERIA } from "./criteria.ts";
import {
  SECTION508_ID,
  SECTION508_LEVELS,
  SECTION508_NAME,
  SECTION508_PUBLISHER,
  SECTION508_URL,
  SECTION508_VERSION,
} from "./metadata.ts";

export const section508 = defineStandard({
  id: SECTION508_ID,
  name: SECTION508_NAME,
  version: SECTION508_VERSION,
  publisher: SECTION508_PUBLISHER,
  url: SECTION508_URL,
  levels: SECTION508_LEVELS,
  criteria: SECTION508_CRITERIA,
});
