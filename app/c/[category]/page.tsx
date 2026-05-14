import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { listByCategory, listCategories } from "@/lib/catalog";
import { ProductGrid } from "@/components/product-grid";

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const db = getDb();
  const cats = await listCategories(db);
  const cat = cats.find((c) => c.slug === category);
  if (!cat) notFound();
  const items = await listByCategory(db, category);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{cat.name}</h1>
        <p className="mt-1 text-muted-foreground">{cat.blurb}</p>
      </header>
      <ProductGrid products={items} />
    </div>
  );
}
