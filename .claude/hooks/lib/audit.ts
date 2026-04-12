// Append-only audit log at .claude/history.jsonl. Best-effort: if the file
// can't be written (e.g., permission issue) we swallow the error so a hook
// never fails because of logging.

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry } from "./types.ts";

const LOG_PATH = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".claude", "history.jsonl");

export function audit(entry: Omit<AuditEntry, "ts">): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    // Log failures never block a hook.
  }
}
