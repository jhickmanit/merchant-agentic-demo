import { getDb, closeDb } from "./index";
import { categories, products } from "./schema";
import { CATEGORIES, PRODUCTS } from "./seed-data";
import { nanoid } from "nanoid";

function picsum(seed: string, size = 800) {
  return `https://picsum.photos/seed/${seed}/${size}/${size}`;
}

async function main() {
  const db = getDb();

  console.log(`Seeding ${CATEGORIES.length} categories and ${PRODUCTS.length} products...`);

  await db.delete(products);
  await db.delete(categories);

  await db.insert(categories).values(CATEGORIES);

  const rows = PRODUCTS.map((p) => ({
    id: nanoid(12),
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    imageUrl: picsum(p.slug),
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
