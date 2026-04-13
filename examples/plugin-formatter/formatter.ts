/**
 * Example ra11y formatter plugin — `slack-markdown`.
 *
 * Produces a Slack-flavored markdown summary designed to paste
 * into an incoming-webhook message. Slack's markdown is a strict
 * subset of the GitHub flavor — no tables, no HTML, no horizontal
 * rules — so this formatter is a good example of shaping output
 * for a target renderer without bending over backwards.
 *
 * Use:
 *
 *   // ra11y.config.ts
 *   import { defineConfig } from "@ra11y/core/plugin";
 *   import slackMarkdown from "./examples/plugin-formatter/formatter.ts";
 *
 *   export default defineConfig({
 *     plugins: { formatters: [slackMarkdown] },
 *   });
 *
 *   // then:
 *   ra11y --format slack-markdown > ra11y-slack.md
 *
 * (Plugin-loader wiring is Phase 15 polish; for v0.0.x the
 * formatter is demonstrated via direct import in the sibling
 * test script.)
 */

// In a real consumer this is:
//   import { defineFormatter } from "@ra11y/core/plugin";
// For the in-repo example, use the relative path so the smoke test
// (`bun test.ts`) can run without publishing or linking.
import { defineFormatter } from "../../src/api/plugin.ts";

const TOP_N = 5;

const slackMarkdown = defineFormatter({
  id: "slack-markdown",
  format(result, _report) {
    const errors = result.violations.filter((v) => v.severity === "error").length;
    const warnings = result.violations.filter((v) => v.severity === "warning").length;
    const infos = result.violations.filter((v) => v.severity === "info").length;

    const lines: string[] = [];
    lines.push("*ra11y accessibility report*");
    lines.push(
      `• ${errors} :red_circle: errors · ${warnings} :large_yellow_circle: warnings · ${infos} :large_blue_circle: notes`,
    );
    lines.push(
      `• scanned ${result.filesScanned} files in ${Math.round(result.durationMs)}ms against ${result.enabledStandards.join(", ")}`,
    );

    if (result.violations.length === 0) {
      lines.push("");
      lines.push(":white_check_mark: no accessibility violations found.");
      return lines.join("\n");
    }

    lines.push("");
    lines.push(`*Top ${Math.min(TOP_N, result.violations.length)}:*`);
    for (const v of result.violations.slice(0, TOP_N)) {
      lines.push(
        `• \`${v.ruleId}\` — ${v.location.filePath}:${v.location.line} — ${v.message}`,
      );
    }
    return lines.join("\n");
  },
});

export default slackMarkdown;
