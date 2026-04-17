interface ImageCardProps {
  src: string;
  alt: string;
  caption?: string;
  aspectRatio?: "square" | "video" | "wide";
}

export function ImageCard({ src, alt, caption, aspectRatio = "video" }: ImageCardProps) {
  const ratios = {
    square: "aspect-square",
    video: "aspect-video",
    wide: "aspect-[21/9]",
  };
  return (
    <figure className="overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-800 shadow-sm">
      <div className={`${ratios[aspectRatio]} w-full overflow-hidden`}>
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
        />
      </div>
      {caption && (
        <figcaption className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
