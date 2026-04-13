// FAILS WCAG 2.2 SC 2.5.7 — file imports @dnd-kit/core but renders no
// click/button alternative, so reordering is drag-only.
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

export function Board({ children }: { children: React.ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={[]}>
        <div>{children}</div>
      </SortableContext>
    </DndContext>
  );
}
