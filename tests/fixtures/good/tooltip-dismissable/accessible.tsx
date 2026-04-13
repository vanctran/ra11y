// Good: interactive elements use accessible labels, not native title tooltips.
export function Toolbar(): JSX.Element {
  return (
    <div>
      <button aria-label="Save document">💾</button>
      <button aria-label="Print">🖨️</button>
      <a href="/help">Help</a>
      <abbr title="World Health Organization">WHO</abbr>
    </div>
  );
}
