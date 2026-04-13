// Draggable element is aria-disabled — drag is inactive, so 2.5.7 does
// not apply.
export function FrozenItem() {
  return (
    <li draggable="true" aria-disabled="true" onDragStart={() => {}}>
      Locked item
    </li>
  );
}
