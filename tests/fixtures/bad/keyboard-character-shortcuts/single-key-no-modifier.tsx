import { useEffect } from "react";

export function HotkeyApp() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s") save();
      if (e.key === "/") openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <main>Type a key.</main>;
}

declare function save(): void;
declare function openSearch(): void;
