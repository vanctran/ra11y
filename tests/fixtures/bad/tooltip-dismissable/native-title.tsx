// Bad: native title attribute on interactive elements fails WCAG 1.4.13.
// Native browser tooltips are not dismissable, hoverable, or persistent.
export function IconBar(): JSX.Element {
  return (
    <div>
      <button title="Save document">💾</button>
      <button title="Print">🖨️</button>
      <a href="/help" title="Open help center">?</a>
      <input type="text" title="Enter your full name" />
    </div>
  );
}
