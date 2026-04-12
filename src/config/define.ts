/**
 * defineConfig helper — an identity function that gives users
 * full type inference when authoring ra11y.config.ts.
 *
 * This is the same pattern as defineRule / defineStandard /
 * defineFormatter — runtime zero-cost, compile-time type hinting.
 * Exported via @ra11y/core so users can:
 *
 *   import { defineConfig } from "@ra11y/core";
 *   export default defineConfig({
 *     standards: ["wcag22", "section508"],
 *     level: "AA",
 *     rules: {
 *       "contrast/minimum": "warn",
 *       "parsing/duplicate-id": "off",
 *     },
 *     overrides: [
 *       {
 *         files: ["src/legacy/**\/*.tsx"],
 *         rules: { "contrast/minimum": "off" },
 *       },
 *     ],
 *   });
 *
 * The runtime import of Config from ../types/config.ts keeps this
 * a pure identity — no validation happens here. Schema errors
 * surface when the loader calls validateConfig() (TODO: Phase 14
 * adds a schema validator; for v0.0.x we trust the types).
 */

import type { Config } from "../types/config.ts";

export function defineConfig(config: Config): Config {
  return config;
}
