/**
 * Labeled fixtures for the prompt-eval harness. Each pairs a prompt
 * name + args with `anchors` (must appear in the rendered text),
 * optional `forbiddenAnchors` (branch-regression guards), and
 * optional `orderedSteps` (step markers that must appear in order).
 * Literal substring matches — drift in template text fails loudly.
 */
export interface PromptFixture {
  readonly label: string;
  readonly promptName: string;
  readonly args: Readonly<Record<string, string>>;
  readonly anchors: readonly string[];
  readonly forbiddenAnchors?: readonly string[];
  readonly orderedSteps?: readonly string[];
}

const STEPS_4 = ["1.", "2.", "3.", "4."] as const;
const STEPS_6 = ["1.", "2.", "3.", "4.", "5.", "6."] as const;

export const PROMPT_FIXTURES: readonly PromptFixture[] = [
  {
    label: "triage — no focus, full-sweep phrasing",
    promptName: "ra11y/triage",
    args: {},
    anchors: [
      "scan_project",
      "verboseMeta: true",
      "checklist",
      "review_candidates",
      "Triage every finding",
      "fail",
      "dismiss",
      "investigate",
      "ra11y-disable",
      "scanConfidence",
      "rulesEvaluated",
    ],
    forbiddenAnchors: ["Restrict triage to findings"],
    orderedSteps: STEPS_4,
  },
  {
    label: "triage — focused on wcag22:1.4.3",
    promptName: "ra11y/triage",
    args: { focus: "wcag22:1.4.3" },
    anchors: ["wcag22:1.4.3", "Restrict triage to findings", "scan_project", "checklist"],
    forbiddenAnchors: ["Triage every finding"],
  },
  {
    label: "fix — no findingId, agent picks target",
    promptName: "ra11y/fix",
    args: {},
    anchors: [
      "scan_project",
      "suggest_fix",
      "apply_fix",
      "configure",
      "allowWrite",
      "dryRun: true",
      "dryRun: false",
      "scan_file",
      "no-fix-available",
    ],
    forbiddenAnchors: ["Target the finding identified as"],
    orderedSteps: STEPS_6,
  },
  {
    label: "fix — explicit findingId anchored in prompt",
    promptName: "ra11y/fix",
    args: { findingId: "contrast/minimum@src/Button.tsx:42" },
    anchors: [
      "contrast/minimum@src/Button.tsx:42",
      "ruleId@file:line",
      "suggest_fix",
      "dryRun: true",
      "allowWrite",
      "applied",
    ],
  },
  {
    label: "audit — default standard (wcag22)",
    promptName: "ra11y/audit",
    args: {},
    anchors: [
      "wcag22",
      "configure",
      "audit",
      "checklist",
      "explain_standard",
      "supports",
      "partially-supports",
      "does-not-support",
      "not-applicable",
      "not-evaluated",
      "vpatNotes",
    ],
    orderedSteps: STEPS_4,
  },
  {
    label: "audit — section508 standard",
    promptName: "ra11y/audit",
    args: { standard: "section508" },
    anchors: ["section508", "configure", 'standard: "section508"', "criteria"],
    forbiddenAnchors: ['standard: "wcag22"'],
  },
  {
    label: "vpat-narrative — criterionId required, default tone",
    promptName: "ra11y/vpat-narrative",
    args: { criterionId: "wcag22:1.4.3" },
    anchors: [
      "wcag22:1.4.3",
      "professional",
      "explain_standard",
      "coverage",
      "checklist",
      "Supports",
      "Partially Supports",
      "Does Not Support",
      "Not Applicable",
      "Not Evaluated",
      "remark",
      "citations",
    ],
  },
  {
    label: "vpat-narrative — plain tone override, section508 criterion",
    promptName: "ra11y/vpat-narrative",
    args: { criterionId: "section508:1194.22.c", tone: "plain" },
    anchors: ["section508:1194.22.c", "plain", "Tone:", "one paragraph"],
    forbiddenAnchors: ["Tone: `professional`"],
  },
];
