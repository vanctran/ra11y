#!/usr/bin/env bun
/**
 * Smoke test for the example rule plugin. Proves the plugin
 * package loads under the public `defineRule` API and produces an
 * id / satisfies / docs shape downstream consumers can rely on.
 * The CI plugin-examples job runs this.
 */

import rule from "./rule.ts";

if (rule.id !== "example/no-title-attribute-as-label") {
  console.error(`✗ unexpected id: ${rule.id}`);
  process.exit(1);
}
if (!rule.satisfies.includes("wcag22:1.1.1")) {
  console.error("✗ missing WCAG 1.1.1 in satisfies");
  process.exit(1);
}
if (!rule.docs?.description) {
  console.error("✗ docs.description missing");
  process.exit(1);
}
console.log("✓ example rule plugin loaded with expected shape");
