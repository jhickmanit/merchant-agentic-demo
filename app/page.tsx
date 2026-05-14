import Link from "next/link";
import { getDb } from "@/db";
import { listCategories, listProducts } from "@/lib/catalog";
import { ProductGrid } from "@/components/product-grid";

export default async function Home() {
  const db = getDb();
  const [cats, allProducts] = await Promise.all([
    listCategories(db),
    listProducts(db),
  ]);
  const featured = allProducts.slice(0, 8);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-12">
      <section>
        <h1 className="text-4xl font-bold tracking-tight">Outdoor gear for trail and trip.</h1>
        <p className="mt-2 text-muted-foreground">
          Hand-picked apparel, footwear, packs, food, and accessories.
        </p>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Shop by category</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cats.map((c) => (
            <Link
              key={c.slug}
              href={`/c/${c.slug}`}
              className="rounded-lg border bg-card p-4 text-center hover:bg-accent"
            >
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.blurb}</div>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Featured</h2>
        <ProductGrid products={featured} />
      </section>
    </div>
  );
}
