// A polite toast region. role="status" supplies politeness; aria-atomic
// makes the whole message re-announce on update.
export function Toast({ message }: { readonly message: string }) {
  return (
    <div role="status" aria-atomic="true">
      {message}
    </div>
  );
}
