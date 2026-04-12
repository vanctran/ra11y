// Shared helpers for computing project state used by session-start and
// user-prompt-submit. Keeps the two hooks in sync.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectState {
  branch: string;
  dirty: boolean;
  dirtyCount: number;
  phaseProgress: PhaseProgress[];
  ruleCount: number;
  standardCount: number;
  testStatus: TestStatus | null;
  lastCommits: string[];
}

export interface PhaseProgress {
  name: string;
  done: number;
  total: number;
}

export interface TestStatus {
  passing: number;
  failing: number;
  durationMs: number;
  timestamp: string;
}

export function getProjectState(projectDir: string): ProjectState {
  return {
    branch: safeGit(projectDir, "rev-parse --abbrev-ref HEAD") ?? "(unknown)",
    ...gitDirty(projectDir),
    phaseProgress: readBacklog(projectDir),
    ruleCount: countTsFiles(join(projectDir, "src", "rules")),
    standardCount: countStandards(join(projectDir, "src", "standards")),
    testStatus: readTestStatus(projectDir),
    lastCommits: safeGit(projectDir, "log --oneline -5")?.split("\n").filter(Boolean) ?? [],
  };
}

function safeGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitDirty(cwd: string): { dirty: boolean; dirtyCount: number } {
  const status = safeGit(cwd, "status --porcelain");
  if (status === null) return { dirty: false, dirtyCount: 0 };
  const lines = status.split("\n").filter(Boolean);
  return { dirty: lines.length > 0, dirtyCount: lines.length };
}

const HEADING_RE = /^## (Phase [0-9]+)(?:\s*—\s*)?(.*)$/;
const ITEM_RE = /^- \[(.)\]/;

function readBacklog(projectDir: string): PhaseProgress[] {
  const path = join(projectDir, ".claude", "backlog.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const phases: PhaseProgress[] = [];
  let current: PhaseProgress | null = null;
  for (const line of text.split("\n")) {
    const next = parseBacklogLine(line, current);
    if (next.pushCurrent && current) phases.push(current);
    if (next.replaceCurrent !== undefined) current = next.replaceCurrent;
  }
  if (current) phases.push(current);
  return phases;
}

interface BacklogLineEffect {
  readonly pushCurrent: boolean;
  readonly replaceCurrent: PhaseProgress | null | undefined;
}

/** Interprets one line of backlog.md, mutating `current` in place if it's an item. */
function parseBacklogLine(line: string, current: PhaseProgress | null): BacklogLineEffect {
  const head = HEADING_RE.exec(line);
  if (head) {
    const label = (head[2] ?? "").trim();
    const next: PhaseProgress = {
      name: `${head[1]}${label ? ` — ${label}` : ""}`,
      done: 0,
      total: 0,
    };
    return { pushCurrent: current !== null, replaceCurrent: next };
  }
  const item = ITEM_RE.exec(line);
  if (item && current) {
    current.total += 1;
    if (item[1] === "x") current.done += 1;
  }
  return { pushCurrent: false, replaceCurrent: undefined };
}

function countTsFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countTsFiles(join(dir, entry.name));
    } else if (entry.name.endsWith(".ts") && entry.name !== "index.ts") {
      count += 1;
    }
  }
  return count;
}

function countStandards(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

function readTestStatus(projectDir: string): TestStatus | null {
  const path = join(projectDir, ".claude", "test-status.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TestStatus;
  } catch {
    return null;
  }
}

export function renderPhaseLine(phase: PhaseProgress, width = 10): string {
  if (phase.total === 0) return `${phase.name}: empty`;
  const filled = Math.round((phase.done / phase.total) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  const pct = Math.round((phase.done / phase.total) * 100);
  return `${bar} ${phase.done}/${phase.total} ${String(pct).padStart(3)}%  ${phase.name}`;
}
