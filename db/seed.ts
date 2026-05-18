import { getDb, closeDb } from "./index";
import { categories, products, cartItems, orderItems } from "./schema";
import { CATEGORIES, PRODUCTS } from "./seed-data";
import { nanoid } from "nanoid";

// placehold.co: deterministic per slug, no broken URLs, on-theme emerald color.
function placeholder(slug: string, size = 800) {
  return `https://placehold.co/${size}x${size}/059669/ffffff?text=${encodeURIComponent(slug)}`;
}

async function main() {
  const db = getDb();

  console.log(`Seeding ${CATEGORIES.length} categories and ${PRODUCTS.length} products...`);

  await db.delete(cartItems);
  await db.delete(orderItems);
  await db.delete(products);
  await db.delete(categories);

  await db.insert(categories).values(CATEGORIES);

  const rows = PRODUCTS.map((p) => ({
    id: nanoid(12),
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    imageUrl: placeholder(p.slug),
    categorySlug: p.categorySlug,
  }));

  await db.insert(products).values(rows);

  console.log("Seed complete.");
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
