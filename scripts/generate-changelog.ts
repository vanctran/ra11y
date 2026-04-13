#!/usr/bin/env bun
/**
 * Generates a Keep-a-Changelog-formatted changelog excerpt from the
 * conventional commits since the last git tag (or since the root
 * commit if no tags exist). Prints to stdout — the release captain
 * reviews and splices the result into CHANGELOG.md by hand.
 *
 * Grouping:
 *   - Added       ← feat
 *   - Changed     ← refactor, perf, build
 *   - Fixed       ← fix
 *   - Removed     ← commits whose subject starts with "remove" or "drop"
 *   - Docs        ← docs
 *   - Internal    ← chore, test, ci (collapsed at bottom)
 *
 * Breaking-change footer (`BREAKING CHANGE:`) surfaces into a
 * dedicated "Breaking" section at the top.
 */

import { spawnSync } from "node:child_process";

const lastTag = run(["git", "describe", "--tags", "--abbrev=0"]).trim();
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const raw = run(["git", "log", range, "--pretty=format:%H\x01%s\x01%b\x02"]);

interface Commit {
  readonly hash: string;
  readonly subject: string;
  readonly body: string;
}

const commits: Commit[] = raw
  .split("\x02")
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [hash = "", subject = "", ...rest] = c.split("\x01");
    return { hash, subject, body: rest.join("\x01") };
  });

const added: string[] = [];
const changed: string[] = [];
const fixed: string[] = [];
const removed: string[] = [];
const docs: string[] = [];
const internal: string[] = [];
const breaking: string[] = [];

for (const c of commits) {
  const type = c.subject.match(/^([a-z]+)(?:\([^)]*\))?!?:/)?.[1] ?? "chore";
  const bang = /^[a-z]+(?:\([^)]*\))?!:/.test(c.subject);
  const item = `- ${c.subject}  (${c.hash.slice(0, 7)})`;
  if (bang || /^BREAKING CHANGE:/m.test(c.body)) breaking.push(item);
  if (type === "feat") added.push(item);
  else if (type === "fix") fixed.push(item);
  else if (type === "docs") docs.push(item);
  else if (type === "refactor" || type === "perf" || type === "build") changed.push(item);
  else internal.push(item);
  if (/^remove|^drop/i.test(c.subject.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, ""))) {
    removed.push(item);
  }
}

const sections: Array<[string, string[]]> = [
  ["Breaking", breaking],
  ["Added", added],
  ["Changed", changed],
  ["Fixed", fixed],
  ["Removed", removed],
  ["Docs", docs],
  ["Internal", internal],
];

const today = new Date().toISOString().slice(0, 10);
const header = lastTag
  ? `## [Unreleased] — ${today} (since ${lastTag})`
  : `## [Unreleased] — ${today}`;

const out = [header, ""];
for (const [name, items] of sections) {
  if (items.length === 0) continue;
  out.push(`### ${name}`, "");
  out.push(...items, "");
}

process.stdout.write(`${out.join("\n")}\n`);

function run(argv: string[]): string {
  const res = spawnSync(argv[0] ?? "", argv.slice(1), { encoding: "utf8" });
  if (res.status !== 0) return "";
  return res.stdout;
}
