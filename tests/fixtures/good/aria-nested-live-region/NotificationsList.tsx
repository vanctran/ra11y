// The list itself is the single live region. Individual notification rows
// carry no aria-live or live-region role, so additions read once via the
// parent's aria-relevant="additions" rather than being announced twice.
export function NotificationsList({
  items,
}: {
  readonly items: readonly { readonly id: string; readonly text: string }[];
}) {
  return (
    <ul aria-live="polite" aria-relevant="additions" aria-atomic="false">
      {items.map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}
