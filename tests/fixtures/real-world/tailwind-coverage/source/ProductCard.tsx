interface ProductCardProps {
  name: string;
  price: string;
  imageAlt: string;
  badge?: string;
}

export function ProductCard({ name, price, imageAlt, badge }: ProductCardProps) {
  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-md hover:shadow-lg transition-shadow">
      {badge && (
        <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-semibold px-2 py-1 rounded-full">
          {badge}
        </span>
      )}
      <div className="aspect-square bg-gray-100 dark:bg-slate-700">
        <img
          src="/placeholder.png"
          alt={imageAlt}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{name}</h3>
        <p className="mt-1 text-lg font-bold text-gray-900 dark:text-slate-100">{price}</p>
        <button
          type="button"
          className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}
