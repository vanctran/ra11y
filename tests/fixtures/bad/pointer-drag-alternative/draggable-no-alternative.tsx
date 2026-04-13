// FAILS WCAG 2.2 SC 2.5.7 — draggable list items have no click,
// button, or keyboard alternative. Users who cannot drag (motor
// impairments, switch input, head pointers) cannot reorder.
export function SortableList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((label) => (
        <li key={label} draggable="true" onDragStart={() => {}}>
          {label}
        </li>
      ))}
    </ul>
  );
}
