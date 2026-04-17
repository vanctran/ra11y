/**
 * Sanitized fixture: debounce hook wrapping setTimeout.
 *
 * Represents the pattern from commit 3ada44a feedback: a hook whose
 * filename contains "debounce" caused the timing finder to attach a
 * "likely not user-facing" hint. That hint was subsequently removed
 * (adb3976) because filename → user-facing classification is a heuristic
 * the agent can perform more accurately by reading the file.
 *
 * Load-bearing call: setTimeout(callback, delay) inside the returned
 * closure. The timing finder must still surface this as a wcag22:2.2.1
 * candidate — no suppression — but must not annotate with a per-file
 * role claim.
 */

export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>): void => {
    if (handle !== null) {
      clearTimeout(handle);
    }
    handle = setTimeout((): void => {
      handle = null;
      fn(...args);
    }, delayMs);
  };
}
