/**
 * Manual review checklist generator.
 *
 * Every criterion marked `automatable: "manual"` appears here as a
 * checkbox entry that a human auditor fills in during a compliance
 * review. The output is Markdown — copy-paste into a tracker, check
 * items off as reviewers complete them, feed back into
 * --certification for the readiness score.
 *
 * Grouped by standard, then by WCAG principle (for WCAG modules).
 * Non-WCAG standards are flat.
 */

import type { ReviewCandidate } from "../types/review.ts";
import type { Standard } from "../types/standard.ts";
import type { PerStandardCoverage } from "./coverage.ts";

export interface ChecklistSection {
  readonly standardId: string;
  readonly standardName: string;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistItem {
  readonly id: string;
  readonly localId: string;
  readonly title: string;
  readonly level: string;
  readonly url: string;
  readonly guidance: string;
  readonly candidates: readonly ReviewCandidate[];
}

export interface ChecklistReport {
  readonly sections: readonly ChecklistSection[];
  readonly totalItems: number;
}

const GUIDANCE_BY_ID: Readonly<Record<string, string>> = {
  // A curated set of guidance prompts for the most-cited manual SCs.
  // The generator falls back to the criterion description when no
  // guidance is registered.
  "wcag22:1.2.1":
    "Review every prerecorded audio-only and video-only asset. Each needs a transcript (audio) or a text or audio alternative (video).",
  "wcag22:1.2.3":
    "Review every prerecorded video. Each needs either audio description of important visual information or a full text/audio alternative.",
  "wcag22:1.4.1":
    "Scan for information conveyed by color alone (status pills, required-field markers, chart legends). Add a non-color signal — icon, pattern, or text label.",
  "wcag22:2.1.2":
    "Keyboard-trap check: Tab through every modal, date picker, and custom widget. Focus must be able to leave the widget with the keyboard.",
  "wcag22:2.3.1":
    "Review any flashing or blinking content — nothing flashes more than 3 times per second or stays below the general/red-flash thresholds.",
  "wcag22:3.1.3":
    "Identify unusual words, jargon, or restricted-meaning terms in your copy. Provide definitions via <dfn>, a glossary, or links.",
  "wcag22:3.2.1":
    "Review onFocus handlers. None should cause a change of context (page navigation, form submission, new window).",
  "wcag22:3.2.2":
    "Review onChange handlers on form controls. None should automatically submit or navigate without user warning.",
};

export function buildChecklist(
  coverage: readonly PerStandardCoverage[],
  standards: readonly Standard[],
  candidates: readonly ReviewCandidate[] = [],
): ChecklistReport {
  const candidatesByCriterion = groupCandidatesByCriterion(candidates);
  const standardById = new Map(standards.map((s) => [s.id, s]));
  const sections: ChecklistSection[] = [];
  let total = 0;

  for (const entry of coverage) {
    const standard = standardById.get(entry.standardId);
    if (!standard) continue;

    const items: ChecklistItem[] = [];
    for (const criterionId of entry.manualCriteria) {
      const criterion = standard.criteria.find((c) => c.id === criterionId);
      if (!criterion) continue;
      items.push({
        id: criterion.id,
        localId: criterion.localId,
        title: criterion.title,
        level: criterion.level,
        url: criterion.url,
        guidance: GUIDANCE_BY_ID[criterion.id] ?? criterion.description,
        candidates: candidatesByCriterion.get(criterion.id) ?? [],
      });
    }

    if (items.length > 0) {
      sections.push({
        standardId: entry.standardId,
        standardName: entry.standardName,
        items: items.sort((a, b) => compareLocalIds(a.localId, b.localId)),
      });
      total += items.length;
    }
  }

  return { sections, totalItems: total };
}

export function renderChecklistMarkdown(report: ChecklistReport): string {
  const lines: string[] = [];
  lines.push("# Manual review checklist");
  lines.push("");
  lines.push(
    "These accessibility criteria cannot be statically checked. A human reviewer must audit each item and check it off. Fill in notes inline and commit this file alongside your VPAT.",
  );
  lines.push("");
  lines.push(`**${report.totalItems} criteria need manual review.**`);
  lines.push("");

  for (const section of report.sections) {
    lines.push(`## ${section.standardName}`);
    lines.push("");
    for (const item of section.items) {
      lines.push(`- [ ] **${item.localId}** ${item.title} · Level ${item.level}`);
      lines.push(`  - ${item.guidance}`);
      lines.push(`  - Spec: ${item.url}`);
      if (item.candidates.length > 0) {
        lines.push(`  - **Review locations** (${item.candidates.length} found):`);
        for (const c of item.candidates) {
          lines.push(`    - \`${c.location.filePath}:${c.location.line}\` — ${c.reason}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function groupCandidatesByCriterion(
  candidates: readonly ReviewCandidate[],
): ReadonlyMap<string, readonly ReviewCandidate[]> {
  const map = new Map<string, ReviewCandidate[]>();
  for (const candidate of candidates) {
    let group = map.get(candidate.criterionId);
    if (!group) {
      group = [];
      map.set(candidate.criterionId, group);
    }
    group.push(candidate);
  }
  return map;
}

function compareLocalIds(a: string, b: string): number {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
