/**
 * Sanitized fixture: batched-flush scheduler whose filename contains "telemetry".
 *
 * Represents the telemetryService pattern from commit 3ada44a feedback. The
 * setTimeout here batches event writes before dispatching — typically
 * infrastructure, but again the filename alone is insufficient evidence.
 *
 * Load-bearing call: setTimeout(flushBatch, FLUSH_INTERVAL_MS).
 * The timing finder must surface this as a wcag22:2.2.1 candidate without
 * adding a "likely not user-facing" claim.
 */

const FLUSH_INTERVAL_MS = 2_000;

const pendingEvents: unknown[] = [];

function sendToCollector(_events: unknown[]): void {
  // Dispatch to the collector endpoint — not relevant to the timing fixture.
}

function flushBatch(): void {
  const batch = pendingEvents.splice(0);
  if (batch.length === 0) return;
  sendToCollector(batch);
}

export function enqueueEvent(event: unknown): void {
  pendingEvents.push(event);
  setTimeout(flushBatch, FLUSH_INTERVAL_MS);
}
