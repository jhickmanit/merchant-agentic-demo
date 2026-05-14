import { ProductCard } from "./product-card";

interface Product {
  slug: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  category: { name: string };
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.slug} {...p} />
      ))}
    </div>
  );
}
