// aria-hidden removes the subtree from the accessibility tree, so any
// updates to this region will never be announced — defeating the
// entire point of the live region.
export function SilentToast({ message }: { readonly message: string }) {
  return (
    <div aria-live="polite" aria-hidden="true">
      {message}
    </div>
  );
}
