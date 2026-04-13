// Tailwind sizing classes that meet or exceed the 24x24 CSS-pixel
// minimum required by WCAG 2.2 SC 2.5.8.
export function Toolbar() {
  return (
    <div>
      <button type="button" className="w-6 h-6">
        ×
      </button>
      <button type="button" className="w-8 h-8">
        ✓
      </button>
      <a href="/" className="w-10 h-10">
        Home
      </a>
    </div>
  );
}
