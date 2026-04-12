/**
 * Default configuration values. Any Config field the user leaves
 * unset falls back to these values during loading.
 */

import type { LoadedConfig } from "../types/config.ts";

export const DEFAULT_CONFIG: LoadedConfig = {
  standards: ["wcag22"],
  level: "AA",
  rules: {},
  exclude: [],
  nativeWrappers: [],
  overrides: [],
  projects: [],
  sourcePath: null,
};
