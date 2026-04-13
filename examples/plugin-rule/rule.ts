/**
 * Example ra11y rule plugin — `no-title-attribute-as-label`.
 *
 * Flags elements that rely on the `title` attribute for their
 * accessible name. The title attribute is notoriously unreliable:
 *
 *   - Mobile browsers don't show tooltips at all.
 *   - Screen readers treat it inconsistently (some announce it,
 *     some don't, some only after a delay).
 *   - It's invisible to keyboard users unless they Tab to the
 *     element, which itself relies on the element being focusable.
 *
 * This rule is a good template for authoring custom rules — it
 * satisfies WCAG 1.1.1 and 4.1.2 but exists in your own plugin
 * because the default `media/alt-text-missing` and
 * `aria/name-role-value` rules don't cover this specific pattern.
 *
 * To use:
 *
 *   // ra11y.config.ts
 *   import { defineConfig } from "@ra11y/core";
 *   import customRule from "./examples/plugin-rule/rule.ts";
 *
 *   export default defineConfig({
 *     standards: ["wcag22"],
 *     plugins: { rules: [customRule] },
 *   });
 *
 * (The plugin-loader wiring is Phase 15 polish; for v0.0.x the
 * rule is demonstrated by importing it directly into a test.)
 */

// In a real consumer this is:
//   import { defineRule } from "@ra11y/core/plugin";
// For the in-repo example, use the relative path so the smoke test
// (`bun test.ts`) can run without publishing or linking.
import { defineRule } from "../../src/api/plugin.ts";

export const rule = defineRule({
  id: "example/no-title-attribute-as-label",
  satisfies: ["wcag22:1.1.1", "wcag22:4.1.2"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Do not rely on the `title` attribute as the only accessible name — it's unreliable on mobile and inconsistent across screen readers.",
    rationale:
      "The title attribute renders as a browser tooltip on desktop mouse-over, but mobile browsers don't show tooltips, keyboard-only users can't trigger them, and screen-reader support is inconsistent. Use aria-label or a visible label instead.",
    goodExample: `<button aria-label="Close">×</button>`,
    badExample: `<button title="Close">×</button>`,
    references: [
      "https://www.w3.org/TR/WCAG22/#non-text-content",
      "https://www.tpgi.com/using-the-html-title-attribute-updated/",
    ],
  },
  check(_ctx) {
    // A real implementation would walk the AST and flag every
    // element whose only accessible name is a `title` attribute.
    // This example is intentionally a no-op so the file stays
    // focused on the plugin API shape, not the AST walking code —
    // see src/rules/media/alt-text-missing.ts for a complete
    // example of the AST walker pattern.
    return [];
  },
});

export default rule;
