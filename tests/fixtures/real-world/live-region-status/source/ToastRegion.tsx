/**
 * ToastRegion — assertive live region for time-critical alerts.
 *
 * This pattern is correct: role="alert" carries the implicit assertive
 * politeness level; no explicit aria-live is needed. The alert container
 * is mounted empty and updated at runtime by the toast manager.
 */

interface ToastRegionProps {
  readonly text: string | null;
}

export function ToastRegion({ text }: ToastRegionProps) {
  return (
    <div role="alert" aria-atomic="true">
      {text !== null && <span>{text}</span>}
    </div>
  );
}

/**
 * BrokenToastRegion — deliberately invalid alert+live combination.
 *
 * Violation: role="alert" (assertive) contradicts aria-live="polite".
 * Different screen readers resolve the conflict differently, producing
 * unpredictable announcement timing.
 */

export function BrokenToastRegion() {
  return (
    <div role="alert" aria-live="polite">
      <span>Operation failed.</span>
    </div>
  );
}

/**
 * HiddenLiveRegion — a live region that is also aria-hidden.
 *
 * Violation: aria-hidden="true" removes the element from the
 * accessibility tree, so updates inside it are never announced even
 * though aria-live="polite" is declared.
 */

export function HiddenLiveRegion() {
  return (
    <div aria-live="polite" aria-hidden="true">
      <p>This update is never announced.</p>
    </div>
  );
}
