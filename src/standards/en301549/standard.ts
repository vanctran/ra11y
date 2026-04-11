/**
 * EN 301 549 Standard export.
 */

import { defineStandard } from "../../api/plugin.ts";
import { EN301549_CRITERIA } from "./criteria.ts";
import {
  EN301549_ID,
  EN301549_LEVELS,
  EN301549_NAME,
  EN301549_PUBLISHER,
  EN301549_URL,
  EN301549_VERSION,
} from "./metadata.ts";

export const en301549 = defineStandard({
  id: EN301549_ID,
  name: EN301549_NAME,
  version: EN301549_VERSION,
  publisher: EN301549_PUBLISHER,
  url: EN301549_URL,
  levels: EN301549_LEVELS,
  criteria: EN301549_CRITERIA,
});
