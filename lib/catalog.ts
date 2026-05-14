import type { DB } from "@/db";
import { categories, products } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function listCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function listProducts(db: DB) {
  return db.query.products.findMany({
    with: { category: true },
    orderBy: asc(products.name),
  });
}

export async function listByCategory(db: DB, categorySlug: string) {
  return db.query.products.findMany({
    where: eq(products.categorySlug, categorySlug),
    with: { category: true },
    orderBy: asc(products.name),
  });
}

export async function getProductBySlug(db: DB, slug: string) {
  const result = await db.query.products.findFirst({
    where: eq(products.slug, slug),
    with: { category: true },
  });
  return result ?? null;
}
