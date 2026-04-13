import { useEffect } from "react";

export function HotkeyApp() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <main>Press Ctrl/Cmd+S to save.</main>;
}

declare function save(): void;
