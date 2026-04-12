/**
 * Public API barrel. Re-exports the surface that end-users and plugin
 * authors consume. Anything that's not here is internal and not covered
 * by the semver policy.
 */

export type * from "../types/index.ts";

export type {
  Formatter,
  FormatterFn,
} from "./plugin.ts";
export {
  defineConfig,
  defineFormatter,
  defineRule,
  defineStandard,
} from "./plugin.ts";
