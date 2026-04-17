interface AvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  const sizes = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-base",
  };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizes[size]} rounded-full object-cover ring-2 ring-white dark:ring-slate-900`}
      />
    );
  }
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      aria-label={name}
      className={`${sizes[size]} inline-flex items-center justify-center rounded-full bg-indigo-500 text-white font-semibold`}
    >
      {initials}
    </span>
  );
}
