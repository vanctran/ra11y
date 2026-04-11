/**
 * Barrel for built-in standards. v0.1.0 ships with wcag22, wcag21,
 * section508, and en301549 — four real conformance frameworks loaded
 * together so one rule can satisfy all four simultaneously via
 * equivalentTo closure in the criteria registry.
 */

import type { Standard } from "../types/standard.ts";
import { en301549 } from "./en301549/standard.ts";
import { section508 } from "./section508/standard.ts";
import { wcag21 } from "./wcag21/standard.ts";
import { wcag22 } from "./wcag22/standard.ts";

export const BUILTIN_STANDARDS: readonly Standard[] = [wcag22, wcag21, section508, en301549];

export { en301549, section508, wcag21, wcag22 };
