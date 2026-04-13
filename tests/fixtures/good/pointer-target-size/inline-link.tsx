// Inline anchors inside <p> qualify for the WCAG 2.2 "Inline" exception:
// their size is constrained by the surrounding text's line-height.
export function Article() {
  return (
    <p>
      Read{" "}
      <a href="/docs" className="w-4 h-4">
        the docs
      </a>{" "}
      for more information about accessibility.
    </p>
  );
}
