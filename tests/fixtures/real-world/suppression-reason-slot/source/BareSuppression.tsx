// Fixture: component with a bare suppression pragma (no reason slot).
// Key omission (rather than empty-string reason) is the load-bearing shape
// contract — meta.suppressions entries distinguish documented from
// un-justified silences by presence of the key, not by string content.

{/* ra11y-disable wcag22:2.4.6 */}
export function BareSuppression() {
  return <h1>Dashboard Overview</h1>;
}

export default BareSuppression;
