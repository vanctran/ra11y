/**
 * Example ra11y standard plugin — "Acme Corp Accessibility Guidelines".
 *
 * A minimal corporate internal guideline that references WCAG 2.2
 * for most of its rules via `equivalentTo`. This is the canonical
 * pattern for corporate, industry, or jurisdiction-specific
 * standards: you don't rewrite the rules — you cite the WCAG
 * criteria you care about and ra11y's existing rules cover them
 * automatically.
 *
 * Usage:
 *
 *   // ra11y.config.ts
 *   import { defineConfig } from "@ra11y/core";
 *   import acme from "./examples/plugin-standard/standard.ts";
 *
 *   export default defineConfig({
 *     standards: ["wcag22", acme],
 *     level: "AA",
 *   });
 *
 * Running `ra11y --standard acme` will then produce violations
 * citing both WCAG 2.2 AND the corresponding acme: criterion ID
 * on every rule that already exists for WCAG — zero rule code
 * added to the plugin.
 */

// In a real consumer this is:
//   import { defineStandard } from "@ra11y/core/plugin";
// For the in-repo example, use the relative path so the smoke test
// (`bun test.ts`) can run without publishing or linking.
import { defineStandard } from "../../src/api/plugin.ts";

export const acmeStandard = defineStandard({
  id: "acme",
  name: "Acme Corp Accessibility Guidelines",
  version: "1.0",
  publisher: "Acme Corp",
  url: "https://example.com/acme-a11y",
  levels: ["base"],
  criteria: [
    {
      id: "acme:a.1",
      standardId: "acme",
      localId: "a.1",
      title: "Text alternatives",
      level: "base",
      description:
        "All images used for content must have a meaningful text alternative.",
      url: "https://example.com/acme-a11y#a.1",
      automatable: "partial",
      equivalentTo: ["wcag22:1.1.1"],
    },
    {
      id: "acme:a.2",
      standardId: "acme",
      localId: "a.2",
      title: "Color contrast",
      level: "base",
      description: "Text contrast ratio must be at least 4.5:1 (or 3:1 for large text).",
      url: "https://example.com/acme-a11y#a.2",
      automatable: "partial",
      equivalentTo: ["wcag22:1.4.3"],
    },
    {
      id: "acme:a.3",
      standardId: "acme",
      localId: "a.3",
      title: "Keyboard access",
      level: "base",
      description: "Every interactive element must be operable via keyboard.",
      url: "https://example.com/acme-a11y#a.3",
      automatable: "partial",
      equivalentTo: ["wcag22:2.1.1"],
    },
    {
      id: "acme:a.4",
      standardId: "acme",
      localId: "a.4",
      title: "Form labels",
      level: "base",
      description: "All form controls must have a programmatically associated label.",
      url: "https://example.com/acme-a11y#a.4",
      automatable: "full",
      equivalentTo: ["wcag22:3.3.2"],
    },
    {
      id: "acme:a.5",
      standardId: "acme",
      localId: "a.5",
      title: "Document language",
      level: "base",
      description: "Every HTML document must declare its primary language.",
      url: "https://example.com/acme-a11y#a.5",
      automatable: "full",
      equivalentTo: ["wcag22:3.1.1"],
    },
  ],
});

export default acmeStandard;
