import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { categories, products } from "@/db/schema";
import { addItem, createCart } from "@/lib/cart";
import { createOrderFromCart, getOrderById, listOrdersForCart } from "@/lib/orders";

function seed(db: ReturnType<typeof freshTestDb>["db"]) {
  db.insert(categories).values([{ slug: "apparel", name: "Apparel", blurb: "" }]).run();
  db.insert(products).values([
    { id: "p1", slug: "tee", name: "Tee", description: "", priceCents: 6500, imageUrl: "x", categorySlug: "apparel" },
    { id: "p2", slug: "cap", name: "Cap", description: "", priceCents: 2900, imageUrl: "x", categorySlug: "apparel" },
  ]).run();
}

describe("orders", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
  });

  it("createOrderFromCart writes order, items, and returns id; subtotal correct", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 2);
    await addItem(testDb.db, cartId, "p2", 1);
    const orderId = await createOrderFromCart(testDb.db, cartId, "stub");
    const order = await getOrderById(testDb.db, orderId);
    expect(order?.paymentMethod).toBe("stub");
    expect(order?.subtotalCents).toBe(6500 * 2 + 2900);
    expect(order?.items).toHaveLength(2);
  });

  it("createOrderFromCart throws on empty cart", async () => {
    const cartId = await createCart(testDb.db);
    await expect(createOrderFromCart(testDb.db, cartId, "stub")).rejects.toThrow();
  });

  it("listOrdersForCart returns descending by createdAt", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 1);
    const o1 = await createOrderFromCart(testDb.db, cartId, "stub");
    await addItem(testDb.db, cartId, "p2", 1);
    const o2 = await createOrderFromCart(testDb.db, cartId, "stub");
    const list = await listOrdersForCart(testDb.db, cartId);
    expect(list.map((o) => o.id)).toEqual([o2, o1]);
  });
});
