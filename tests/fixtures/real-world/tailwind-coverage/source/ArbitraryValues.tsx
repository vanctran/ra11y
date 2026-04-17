/**
 * Exercises Tailwind arbitrary-value syntax: w-[42px], text-[#FF00AA],
 * grid-cols-[1fr_2fr], and the important-prefix modifier.
 * These patterns appear in real codebases using design-token overrides
 * or one-off layout constraints that don't map to a named scale step.
 */
interface ArbitraryValuesProps {
  accentColor?: string;
}

export function ArbitraryValues({ accentColor = "#6366f1" }: ArbitraryValuesProps) {
  return (
    <section aria-label="Arbitrary value demo">
      <div className="grid grid-cols-[1fr_2fr] gap-4 w-[640px] max-w-full">
        <aside className="w-[180px] min-h-[320px] bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
          <p className="text-[13px] leading-[1.6] text-gray-600 dark:text-slate-400">
            Sidebar content with arbitrary font size and line height.
          </p>
        </aside>
        <main>
          <h2
            className="text-[22px] font-bold mb-4"
            style={{ color: accentColor }}
          >
            Main area
          </h2>
          <div className="h-[2px] w-[60px] bg-[#e2e8f0] dark:bg-[#334155] mb-4" aria-hidden="true" />
          <p className="text-sm text-gray-700 dark:text-slate-300 max-w-[480px]">
            Content with constrained max-width using arbitrary pixel values.
          </p>
        </main>
      </div>
    </section>
  );
}
