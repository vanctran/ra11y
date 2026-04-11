# /continue gotchas

Known failure modes and how to avoid them. Update this file whenever an autonomous run surfaces a new issue.

## The specialist returns without committing

Symptom: after a subagent run, `git log` shows no new commits but the working tree has changes.

Fix: every subagent definition includes a commit-discipline section. If a subagent forgot to commit, re-dispatch with "You did not commit. Commit your work per the discipline in your definition and return." Do not commit on their behalf — that loses attribution and masks the bug.

## Backlog items that span phases

Symptom: an item like "adding this rule also requires updating the standards-audit checklist."

Fix: split the item in place before dispatching. Edit `.claude/backlog.md` to insert the missing sub-item, commit, then dispatch.

## Items classified to the wrong specialist

Symptom: `rule-implementer` refuses an item that's actually a types change.

Fix: re-read the item, reclassify, re-dispatch. Do not force a specialist to work outside its remit — the invariants in its definition will reject the work.

## Loop budget exhausted mid-phase

Symptom: hit 20 iterations and the phase isn't done.

Fix: this is normal. Summarize, check in the partial progress, yield. User runs `/continue` again when ready. The next run picks up where this one stopped.

## Verify fails between iterations

Symptom: item N+1 runs on a tree where item N introduced a regression.

Fix: `/continue` always runs `/verify` after every dispatch before checking off and moving on. If an iteration left verify red, the next iteration's first action is to fix it, not to pick up the next backlog item.

## Same item re-dispatched indefinitely

Symptom: re-dispatch loop never converges.

Fix: hard cap of 2 re-dispatches per item. After that, mark the item as BLOCKED in the summary and move on. Never loop forever.
