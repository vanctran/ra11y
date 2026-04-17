/**
 * Sanitized fixture: token-refresh scheduler whose filename contains "auth".
 *
 * Represents the authManager pattern from commit 3ada44a feedback. The
 * setTimeout here schedules a credential refresh before the current token
 * expires — arguably infrastructure, but an authManager can also house a
 * real session-timeout that requires a WCAG 2.2.1 user control. Filename
 * alone is insufficient evidence to classify it.
 *
 * Load-bearing call: setTimeout(refreshAccessToken, expiresIn - BUFFER_MS).
 * The timing finder must surface this as a wcag22:2.2.1 candidate without
 * adding a "likely not user-facing" claim.
 */

const REFRESH_BUFFER_MS = 60_000;

function refreshAccessToken(): void {
  // Exchange the stored refresh token for a new access token.
  // Implementation omitted — not relevant to the timing-candidate fixture.
}

export function scheduleTokenRefresh(expiresInMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(refreshAccessToken, expiresInMs - REFRESH_BUFFER_MS);
}
