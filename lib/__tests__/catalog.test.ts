import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { listCategories, listProducts, listByCategory, getProductBySlug } from "@/lib/catalog";
import { categories, products } from "@/db/schema";

function seed(db: ReturnType<typeof freshTestDb>["db"]) {
  db.insert(categories).values([
    { slug: "apparel", name: "Apparel", blurb: "Layers." },
    { slug: "food", name: "Trail Food", blurb: "Snacks." },
  ]).run();
  db.insert(products).values([
    { id: "p1", slug: "tee", name: "Merino Tee", description: "Soft.", priceCents: 6500, imageUrl: "https://x/tee", categorySlug: "apparel" },
    { id: "p2", slug: "bar", name: "Bar", description: "Sweet.", priceCents: 400, imageUrl: "https://x/bar", categorySlug: "food" },
    { id: "p3", slug: "cap", name: "Cap", description: "Mesh back.", priceCents: 2900, imageUrl: "https://x/cap", categorySlug: "apparel" },
  ]).run();
}

describe("catalog", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
  });

  it("listCategories returns all categories alphabetized by name", async () => {
    const result = await listCategories(testDb.db);
    expect(result.map((c) => c.slug)).toEqual(["apparel", "food"]);
  });

  it("listProducts returns all products with category attached", async () => {
    const result = await listProducts(testDb.db);
    expect(result).toHaveLength(3);
    expect(result[0].category.slug).toBeDefined();
  });

  it("listByCategory filters by slug", async () => {
    const result = await listByCategory(testDb.db, "apparel");
    expect(result.map((p) => p.slug).sort()).toEqual(["cap", "tee"]);
  });

  it("getProductBySlug returns product or null", async () => {
    const found = await getProductBySlug(testDb.db, "tee");
    expect(found?.name).toBe("Merino Tee");
    const notFound = await getProductBySlug(testDb.db, "nope");
    expect(notFound).toBeNull();
  });
});
