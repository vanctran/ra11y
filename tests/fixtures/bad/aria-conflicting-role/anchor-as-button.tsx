// <a href="…" role="button"> — the anchor behaves like a link
// (right-click open-in-new-tab, middle-click, href copy) but AT
// announces it as a button. Fix: use <button type="button"> for
// actions, or drop role="button" if navigation is the intent.
export function DocsLink(): JSX.Element {
  return (
    <a href="/docs" role="button">
      Read the docs
    </a>
  );
}
