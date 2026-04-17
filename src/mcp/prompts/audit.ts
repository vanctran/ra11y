/**
 * Prompt: ra11y/audit — guides an end-to-end conformance audit across a
 * standard's criteria, producing a coverage summary and a set of
 * VPAT-ready notes an agent can later feed into `ra11y/vpat-narrative`.
 */
import type { Prompt } from "./types.ts";

const DEFAULT_STANDARD = "wcag22";

export const auditPrompt: Prompt = {
  name: "ra11y/audit",
  description:
    "Run an end-to-end conformance audit for a standard: one-shot `audit` tool call, walk the checklist by criterion, and emit a coverage summary plus VPAT-ready notes.",
  arguments: [
    {
      name: "standard",
      description:
        "Standard ID to audit against (e.g. wcag22, wcag21, section508, en301549). Defaults to wcag22.",
      required: false,
    },
  ],
  render(args) {
    const standard = args["standard"] ?? DEFAULT_STANDARD;
    const text = [
      `You are running a conformance audit against \`${standard}\`. Work in order:`,
      "",
      `1. Call \`configure\` with \`{ standard: "${standard}" }\` so all subsequent calls inherit the standard.`,
      "2. Call `audit` with the project root. This one-shot meta-tool runs the automated scan plus the manual checklist in a single round trip — read its response end to end.",
      "3. For each criterion in the audit response, fetch detail via `checklist` filtered to that criterion when the audit flagged it as `manualReviewRequired` or `partial`. Use `explain_standard` to retrieve the normative text and level for any criterion you will cite.",
      "4. Walk every file:line candidate the checklist returned. Use `Read` on the file to verify or dismiss — same rules as `ra11y/triage`. Do not downgrade by hunch.",
      "5. For each criterion, classify status as one of: `supports` (automated clean AND no outstanding manual candidates), `partially-supports` (some candidates remain), `does-not-support` (confirmed violations remain), `not-applicable` (no applicable code in scope — cite evidence), `not-evaluated` (runtime-only, name the runtime harness needed).",
      "",
      "Return this shape as your final message:",
      `- \`standard\`: "${standard}" (echo back).`,
      "- `coverage`: `{ automatedCriteriaEvaluated, manualCriteriaReviewed, runtimeOnlyCriteria }` — counts from the audit response and from your own traversal.",
      "- `criteria`: array of `{ criterionId, level, status, evidence }` one entry per criterion in the standard. `evidence` cites specific `file:line` locations from scan or checklist candidates, or names the runtime harness for `not-evaluated`.",
      "- `vpatNotes`: array of `{ criterionId, remark }` one-paragraph strings per criterion suitable as the seed for the VPAT `Remarks and explanations` cell. The `ra11y/vpat-narrative` prompt refines these further; produce first drafts here.",
      "Stop once every criterion in the standard has an entry in `criteria`.",
    ].join("\n");
    return [{ role: "user", content: { type: "text", text } }];
  },
};
