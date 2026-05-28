// The outer container declares `role="status"` (implicitly polite live
// region). A nested sr-only div with `aria-live="polite"` re-declares
// the same channel underneath it — overlapping live regions have no
// defined resolution and many screen readers re-announce the entire
// outer region every time the inner one mutates.
export function StatusReadout({ content }: { readonly content: string }) {
  return (
    <div role="status" aria-atomic="false">
      <p aria-hidden="true">{content}</p>
      <div className="sr-only" aria-live="polite">
        {content}
      </div>
    </div>
  );
}
