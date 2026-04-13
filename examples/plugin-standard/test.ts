#!/usr/bin/env bun
/**
 * Smoke test for the example standard plugin. Proves the plugin
 * package loads under the public `defineStandard` API and emits
 * the criterion list downstream consumers can introspect. The CI
 * plugin-examples job runs this.
 */

import { acmeStandard } from "./standard.ts";

if (acmeStandard.id !== "acme") {
  console.error(`✗ unexpected id: ${acmeStandard.id}`);
  process.exit(1);
}
if (acmeStandard.criteria.length === 0) {
  console.error("✗ expected at least one criterion");
  process.exit(1);
}

const first = acmeStandard.criteria[0];
if (!first?.equivalentTo || first.equivalentTo.length === 0) {
  console.error("✗ example should demonstrate equivalentTo mapping");
  process.exit(1);
}
console.log(
  `✓ example standard loaded: ${acmeStandard.criteria.length} criteria with WCAG equivalence mapping`,
);
