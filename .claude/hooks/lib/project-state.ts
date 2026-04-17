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
  trackProgress: TrackProgress[];
  shipState: ShipState | null;
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

export interface TrackProgress {
  id: string;
  name: string;
  done: number;
  total: number;
}

export interface ShipState {
  v010: string;
  v020: string;
  v030: string;
}

export interface TestStatus {
  passing: number;
  failing: number;
  durationMs: number;
  timestamp: string;
}

export function getProjectState(projectDir: string): ProjectState {
  const backlog = readBacklog(projectDir);
  return {
    branch: safeGit(projectDir, "rev-parse --abbrev-ref HEAD") ?? "(unknown)",
    ...gitDirty(projectDir),
    phaseProgress: backlog.phases,
    trackProgress: backlog.tracks,
    shipState: backlog.shipState,
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

const PHASE_HEADING_RE = /^## (Phase [0-9]+(?:\.[0-9]+)?)(?:\s*—\s*)?(.*)$/;
const TRACK_HEADING_RE = /^## Track ([A-Z])(?:\s*—\s*)?(.*)$/;
const SHIP_STATE_HEADING_RE = /^## Ship state\s*$/;
const SKIP_SECTION_RE = /^## (Dispatch model|History)/;
const ITEM_RE = /^- \[(.)\]/;
const SHIP_BULLET_RE = /^-\s+\*\*(v0\.[0-9]+\.[0-9]+\+?)\s+—\s+([^*]+)\.\*\*/;

interface BacklogParse {
  readonly phases: PhaseProgress[];
  readonly tracks: TrackProgress[];
  readonly shipState: ShipState | null;
}

type SectionKind = "phase" | "track" | "ship" | "skip" | null;

interface ParseState {
  kind: SectionKind;
  currentPhase: PhaseProgress | null;
  currentTrack: TrackProgress | null;
  readonly phases: PhaseProgress[];
  readonly tracks: TrackProgress[];
  readonly shipState: Partial<ShipState>;
}

function readBacklog(projectDir: string): BacklogParse {
  const path = join(projectDir, ".claude", "backlog.md");
  if (!existsSync(path)) return { phases: [], tracks: [], shipState: null };
  const text = readFileSync(path, "utf8");
  const state: ParseState = {
    kind: null,
    currentPhase: null,
    currentTrack: null,
    phases: [],
    tracks: [],
    shipState: {},
  };
  for (const line of text.split("\n")) {
    processBacklogLine(line, state);
  }
  flushCurrentSection(state);
  return {
    phases: state.phases,
    tracks: state.tracks,
    shipState: finalizeShipState(state.shipState),
  };
}

function processBacklogLine(line: string, state: ParseState): void {
  const heading = matchHeading(line);
  if (heading) {
    flushCurrentSection(state);
    applyHeading(heading, state);
    return;
  }
  if (state.kind === "ship") {
    applyShipBullet(line, state.shipState);
    return;
  }
  const item = ITEM_RE.exec(line);
  if (!item) return;
  recordItem(item[1] === "x", state);
}

type HeadingMatch =
  | { kind: "phase"; name: string }
  | { kind: "track"; id: string; name: string }
  | { kind: "ship" }
  | { kind: "skip" }
  | { kind: "other" };

function matchHeading(line: string): HeadingMatch | null {
  const phaseHead = PHASE_HEADING_RE.exec(line);
  if (phaseHead) {
    const label = (phaseHead[2] ?? "").trim();
    return { kind: "phase", name: `${phaseHead[1]}${label ? ` — ${label}` : ""}` };
  }
  const trackHead = TRACK_HEADING_RE.exec(line);
  if (trackHead) {
    const id = trackHead[1] ?? "";
    const label = (trackHead[2] ?? "").trim();
    return { kind: "track", id, name: `Track ${id}${label ? ` — ${label}` : ""}` };
  }
  if (SHIP_STATE_HEADING_RE.test(line)) return { kind: "ship" };
  if (SKIP_SECTION_RE.test(line)) return { kind: "skip" };
  if (/^## /.test(line)) return { kind: "other" };
  return null;
}

function applyHeading(heading: HeadingMatch, state: ParseState): void {
  if (heading.kind === "phase") {
    state.currentPhase = { name: heading.name, done: 0, total: 0 };
    state.kind = "phase";
    return;
  }
  if (heading.kind === "track") {
    state.currentTrack = { id: heading.id, name: heading.name, done: 0, total: 0 };
    state.kind = "track";
    return;
  }
  state.kind = heading.kind === "other" ? null : heading.kind;
}

function flushCurrentSection(state: ParseState): void {
  if (state.currentPhase) {
    state.phases.push(state.currentPhase);
    state.currentPhase = null;
  }
  if (state.currentTrack) {
    state.tracks.push(state.currentTrack);
    state.currentTrack = null;
  }
}

function recordItem(done: boolean, state: ParseState): void {
  if (state.kind === "phase" && state.currentPhase) {
    state.currentPhase.total += 1;
    if (done) state.currentPhase.done += 1;
  } else if (state.kind === "track" && state.currentTrack) {
    state.currentTrack.total += 1;
    if (done) state.currentTrack.done += 1;
  }
}

function applyShipBullet(line: string, shipState: Partial<ShipState>): void {
  const bullet = SHIP_BULLET_RE.exec(line);
  if (!bullet) return;
  const [, version, status] = bullet;
  if (!(version && status)) return;
  const trimmed = status.trim();
  if (version.startsWith("v0.1.")) shipState.v010 = trimmed;
  else if (version.startsWith("v0.2.")) shipState.v020 = trimmed;
  else if (version.startsWith("v0.3.")) shipState.v030 = trimmed;
}

function finalizeShipState(shipState: Partial<ShipState>): ShipState | null {
  if (!(shipState.v010 || shipState.v020 || shipState.v030)) return null;
  return {
    v010: shipState.v010 ?? "",
    v020: shipState.v020 ?? "",
    v030: shipState.v030 ?? "",
  };
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

export function renderTrackLine(track: TrackProgress, width = 10): string {
  if (track.total === 0) return `${track.name}: empty`;
  const filled = Math.round((track.done / track.total) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  const open = track.total - track.done;
  return `${bar} ${track.done}/${track.total}  ${track.name} (${open} open)`;
}
