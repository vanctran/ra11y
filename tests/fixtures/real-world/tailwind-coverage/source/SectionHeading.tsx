interface SectionHeadingProps {
  title: string;
  description?: string;
  level?: 2 | 3 | 4;
}

export function SectionHeading({ title, description, level = 2 }: SectionHeadingProps) {
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  const sizes: Record<2 | 3 | 4, string> = {
    2: "text-xl font-bold",
    3: "text-lg font-semibold",
    4: "text-base font-semibold",
  };
  return (
    <div className="mb-6">
      <Tag className={`${sizes[level]} text-gray-900 dark:text-slate-100`}>{title}</Tag>
      {description && (
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{description}</p>
      )}
    </div>
  );
}
