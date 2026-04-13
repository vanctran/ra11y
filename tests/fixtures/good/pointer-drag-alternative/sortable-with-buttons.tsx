// WCAG 2.2 SC 2.5.7 — drag has a single-pointer alternative.
// Each draggable item also exposes Move Up / Move Down buttons.
import { useDrag } from "react-dnd";

export function SortableList({ items, onMove }: { items: string[]; onMove: (i: number, dir: 1 | -1) => void }) {
  return (
    <ul>
      {items.map((label, i) => (
        <li key={label} draggable="true" onDragStart={() => useDrag(label)}>
          <span>{label}</span>
          <button type="button" onClick={() => onMove(i, -1)} aria-label={`Move ${label} up`}>
            ↑
          </button>
          <button type="button" onClick={() => onMove(i, 1)} aria-label={`Move ${label} down`}>
            ↓
          </button>
        </li>
      ))}
    </ul>
  );
}
