import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getProductBySlug } from "@/lib/catalog";
import { formatCents } from "@/lib/format";
import { AddToCartButton } from "@/components/add-to-cart-button";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(getDb(), slug);
  if (!product) notFound();
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-6 py-10 md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-xl bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
      </div>
      <div className="space-y-6">
        <div>
          <Link
            href={`/c/${product.categorySlug}`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {product.category.name}
          </Link>
          <h1 className="mt-1 text-3xl font-bold">{product.name}</h1>
        </div>
        <div className="text-2xl font-semibold">{formatCents(product.priceCents)}</div>
        <p className="text-muted-foreground">{product.description}</p>
        <AddToCartButton productId={product.id} />
      </div>
    </div>
  );
}
