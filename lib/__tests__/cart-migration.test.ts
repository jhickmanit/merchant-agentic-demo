import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { addItem, createCart } from "@/lib/cart";
import { categories, products, carts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { claimCartForUser } from "@/lib/cart-migration";

function seed(db: ReturnType<typeof freshTestDb>["db"]) {
  db.insert(categories).values([{ slug: "a", name: "A", blurb: "" }]).run();
  db.insert(products).values([
    { id: "p1", slug: "p1", name: "p1", description: "", priceCents: 100, imageUrl: "x", categorySlug: "a" },
    { id: "p2", slug: "p2", name: "p2", description: "", priceCents: 200, imageUrl: "x", categorySlug: "a" },
  ]).run();
}

describe("claimCartForUser", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
  });

  it("sets userId on anonymous cart when user has no prior cart", async () => {
    const anon = await createCart(testDb.db);
    await addItem(testDb.db, anon, "p1", 2);
    const result = await claimCartForUser(testDb.db, anon, "user-1");
    expect(result.cartId).toBe(anon);
    const row = await testDb.db.query.carts.findFirst({ where: eq(carts.id, anon) });
    expect(row?.userId).toBe("user-1");
  });

  it("merges anonymous items into the user's existing cart", async () => {
    const existing = await createCart(testDb.db);
    testDb.db.update(carts).set({ userId: "user-1" }).where(eq(carts.id, existing)).run();
    await addItem(testDb.db, existing, "p1", 1);

    const anon = await createCart(testDb.db);
    await addItem(testDb.db, anon, "p1", 2);
    await addItem(testDb.db, anon, "p2", 5);

    const result = await claimCartForUser(testDb.db, anon, "user-1");
    expect(result.cartId).toBe(existing);
    const cart = await testDb.db.query.carts.findFirst({
      where: eq(carts.id, existing),
      with: { items: true },
    });
    const p1 = cart?.items.find((i) => i.productId === "p1");
    const p2 = cart?.items.find((i) => i.productId === "p2");
    expect(p1?.quantity).toBe(3);
    expect(p2?.quantity).toBe(5);
  });

  it("is a no-op when the anonymous cart is empty or unknown", async () => {
    const result = await claimCartForUser(testDb.db, "no-such-cart", "user-1");
    expect(result.cartId).toBeNull();
  });
});
