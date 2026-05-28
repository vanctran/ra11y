// The parent feed already exposes `aria-live="polite"`, so additions are
// announced once. Wrapping each row in its own `role="status"` introduces
// a second, nested live region per row — screen readers diverge on how
// to resolve overlapping live regions and several re-announce the entire
// outer list whenever any descendant mutates.
export function FeedItem({
  id,
  text,
}: {
  readonly id: string;
  readonly text: string;
}) {
  return (
    <ul aria-live="polite" aria-relevant="additions">
      <li role="status" key={id}>
        {text}
      </li>
    </ul>
  );
}
