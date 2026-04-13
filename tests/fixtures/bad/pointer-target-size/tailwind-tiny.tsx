// Tailwind sizing utilities resolve to less than 24x24 CSS pixels —
// fails WCAG 2.2 SC 2.5.8 Target Size (Minimum).
export function Toolbar() {
  return (
    <div className="flex">
      <button type="button" className="w-4 h-4">
        ×
      </button>
      <button type="button" className="w-[20px] h-[20px]">
        ✓
      </button>
      <div role="button" className="w-5 h-5">
        Menu
      </div>
    </div>
  );
}
