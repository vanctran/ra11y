// Fixture: Storybook-style "intentionally bad example" component that
// demonstrates a missing alt attribute on purpose — the demo teaches the
// violation by surfacing it in the story. The JSDoc
// `@ra11y-intentional <reason>` tag scopes a wildcard disable over the
// decorated declaration's body so the teaching component's expected
// violation is silenced without silencing the rest of the file.

/** @ra11y-intentional demo of missing alt attribute on image */
export function BadImageExample() {
  return <img src="/teaching/chart.png" />;
}

export function CleanComponent() {
  // No JSDoc tag — this declaration is NOT within the scoped disable,
  // so its violations must still surface. Guards that the tag's scope
  // is limited to the declaration body it decorates.
  return <img src="/ok/chart.png" />;
}
