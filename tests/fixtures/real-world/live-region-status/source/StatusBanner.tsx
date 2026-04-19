/**
 * StatusBanner — polite live region for non-urgent status updates.
 *
 * This pattern is correct: role="status" carries the implicit polite
 * politeness level; no explicit aria-live is needed. Children are
 * updated at runtime by the parent.
 */

interface StatusBannerProps {
  readonly message: string | null;
}

export function StatusBanner({ message }: StatusBannerProps) {
  return (
    <div role="status" aria-atomic="true">
      {message !== null && <p>{message}</p>}
    </div>
  );
}

/**
 * BrokenStatusBanner — deliberately invalid live region declarations.
 *
 * Three violations are exercised here:
 *
 *  1. aria-live="bogus"           — invalid token value
 *  2. role="status" + aria-live="assertive"  — politeness contradiction
 *  3. aria-atomic="maybe"         — invalid aria-atomic value
 */

export function BrokenStatusBanner() {
  return (
    <div>
      {/* Violation 1: invalid aria-live token */}
      <div aria-live="bogus">
        <p>Pending save…</p>
      </div>

      {/* Violation 2: role="status" (polite) contradicts aria-live="assertive" */}
      <div role="status" aria-live="assertive">
        <p>Record updated.</p>
      </div>

      {/* Violation 3: invalid aria-atomic value */}
      <div aria-live="polite" aria-atomic="maybe">
        <p>Changes saved.</p>
      </div>
    </div>
  );
}
