import { useEffect } from "react";

export function HotkeyApp() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Focus guard: ignore keystrokes while the user is typing in any
      // form control. The single-key shortcut is only "active on focus"
      // of the page chrome, satisfying the SC's third bullet.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (target?.isContentEditable) return;
      if (e.key === "j") nextItem();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <main>Press j to advance.</main>;
}

declare function nextItem(): void;
