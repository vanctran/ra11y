/**
 * Prompt: ra11y/vpat-narrative — drafts the "Remarks and explanations"
 * cell of a VPAT row for one criterion, grounded in scan + checklist
 * output so the narrative cites specific findings rather than generic
 * conformance language.
 */
import type { Prompt } from "./types.ts";

const DEFAULT_TONE = "professional";

export const vpatNarrativePrompt: Prompt = {
  name: "ra11y/vpat-narrative",
  description:
    "Draft the VPAT `Remarks and explanations` cell for one criterion, grounded in ra11y scan + checklist output.",
  arguments: [
    {
      name: "criterionId",
      description:
        "Criterion ID to draft the Remarks cell for (e.g. wcag22:1.4.3, section508:1194.22.c).",
      required: true,
    },
    {
      name: "tone",
      description:
        "Register for the narrative. One of `professional`, `plain`, `technical`. Defaults to `professional`.",
      required: false,
    },
  ],
  render(args) {
    const criterionId = args["criterionId"] ?? "";
    const tone = args["tone"] ?? DEFAULT_TONE;
    const text = [
      `You are drafting the VPAT \`Remarks and explanations\` cell for criterion \`${criterionId}\`. Tone: \`${tone}\`.`,
      "",
      "Work in order:",
      `1. Call \`explain_standard\` with \`{ criterionId: "${criterionId}" }\` to retrieve the normative text, level, and which ra11y rules satisfy it.`,
      `2. Call \`coverage\` with \`{ criterionId: "${criterionId}" }\` to learn automated-rule coverage — whether any rule fires on the criterion, and whether the criterion is manual-only.`,
      `3. Call \`checklist\` filtered to \`${criterionId}\` to pull grounded review candidates with file:line locations. Read each cited file to confirm or dismiss.`,
      "4. Synthesize the automated result + your manual-review verdicts into one paragraph. Cite specific `file:line` locations when the narrative references a finding. Do not hedge with `may` / `might` when the scanner produced a concrete verdict; do hedge when the evidence is static-only and runtime behavior would be the arbiter.",
      "",
      "Paragraph rules:",
      "- One paragraph, 2–5 sentences. No bullet lists — VPAT cells are prose.",
      "- Lead with the conformance verdict (`Supports`, `Partially Supports`, `Does Not Support`, `Not Applicable`, `Not Evaluated`).",
      "- Cite at least one specific artifact when the verdict is anything but `Supports`: a file path, a component name, or the runtime harness that would complete the evaluation.",
      "- No marketing language. No `we believe`, `our approach`, or `best-in-class`. Factual, auditor-ready.",
      `- Register: \`${tone}\`. \`professional\` = standard VPAT phrasing. \`plain\` = short sentences, no jargon. \`technical\` = spec-language allowed (ARIA, DOM, CSPM).`,
      "",
      "Return this shape as your final message:",
      `- \`criterionId\`: "${criterionId}" (echo back).`,
      "- `verdict`: the conformance verdict you led the paragraph with.",
      "- `remark`: the single-paragraph cell text.",
      "- `citations`: array of `{ file, line, note }` for each artifact cited in `remark`.",
      "Stop after producing the paragraph. Do not propose fixes — that is `ra11y/fix`'s job.",
    ].join("\n");
    return [{ role: "user", content: { type: "text", text } }];
  },
};
