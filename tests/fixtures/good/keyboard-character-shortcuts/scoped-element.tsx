import { useEffect, useRef } from "react";

export function ScopedShortcut() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s") save();
    };
    // Listener attached to a specific element, not window/document —
    // shortcut is intrinsically active-only-on-focus of that element.
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, []);
  return <div ref={ref} tabIndex={0} />;
}

declare function save(): void;
