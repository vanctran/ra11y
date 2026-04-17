/**
 * Prompt: ra11y/triage — guides an agent through a scan → read → verdict
 * loop on each finding and review candidate, ending in a compact triage
 * summary the host can show or archive.
 */
import type { Prompt } from "./types.ts";

export const triagePrompt: Prompt = {
  name: "ra11y/triage",
  description:
    "Run a full ra11y triage pass: scan the project, read each finding in context, verdict fail/dismiss per candidate, and return a compact summary.",
  arguments: [
    {
      name: "focus",
      description:
        "Optional criterion ID (e.g. wcag22:1.4.3) or rule ID (e.g. contrast/minimum) to restrict triage to. Omit to triage everything.",
      required: false,
    },
  ],
  render(args) {
    const focus = args["focus"];
    const focusLine = focus
      ? `Restrict triage to findings and candidates matching \`${focus}\`. Skip everything else.`
      : "Triage every finding and every review candidate returned.";
    const text = [
      "You are triaging accessibility findings produced by ra11y. Work in order:",
      "",
      "1. Call `scan_project` with the project root. Pass `verboseMeta: true` so you see `configSource`, `activeNativeWrappers`, `rulesEvaluated`, and `filesByExtension` — those are scan-confidence telemetry; cite them in the summary.",
      "2. Call `checklist` to enumerate manual-review criteria grounded in file:line candidates.",
      "3. Call `review_candidates` if the checklist returned any criterion without a ranked candidate.",
      `4. ${focusLine}`,
      "",
      "For each finding or candidate:",
      "- Use `Read` on the cited file around the line to see the surrounding JSX/HTML/CSS.",
      "- Weigh the candidate's `reason` text against what you actually read. Do not downgrade by hunch — the tool already prunes by `likelyIrrelevant` and `uniquePerCriterion`.",
      "- Emit a verdict: `fail` (real violation — keep it), `dismiss` (N/A in context — explain why), or `investigate` (needs another tool call; name which).",
      "- If `dismiss`, propose the source-level pragma — `{/* ra11y-disable wcag22:X.Y.Z */}` for TSX/JSX, `<!-- ra11y-disable wcag22:X.Y.Z -->` for HTML, `/* ra11y-disable wcag22:X.Y.Z */` for CSS — with a one-line reason captured in the pragma suffix.",
      "",
      "Return this shape as your final message:",
      "- A top-level `summary` with total findings scanned, total verdicted `fail`, total `dismiss`, total `investigate`.",
      "- A `verdicts` array of `{ file, line, ruleOrCriterion, verdict, reason }` one entry per finding/candidate triaged.",
      "- A `scanConfidence` object echoing the meta you cite (`configSource`, `rulesEvaluated`, `filesByExtension`).",
      "Stop once every item is verdicted. Do not re-scan unless a pragma was applied and you want to verify the delta.",
    ].join("\n");
    return [{ role: "user", content: { type: "text", text } }];
  },
};
