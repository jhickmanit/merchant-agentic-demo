import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { createCart, getCartWithItems, addItem, removeItem, updateQuantity } from "@/lib/cart";
import { categories, products } from "@/db/schema";

function seed(db: ReturnType<typeof freshTestDb>["db"]) {
  db.insert(categories).values([{ slug: "apparel", name: "Apparel", blurb: "" }]).run();
  db.insert(products).values([
    { id: "p1", slug: "tee", name: "Tee", description: "", priceCents: 6500, imageUrl: "x", categorySlug: "apparel" },
    { id: "p2", slug: "cap", name: "Cap", description: "", priceCents: 2900, imageUrl: "x", categorySlug: "apparel" },
  ]).run();
}

describe("cart repo", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
  });

  it("createCart returns a new cart with empty items", async () => {
    const id = await createCart(testDb.db);
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items).toEqual([]);
  });

  it("addItem inserts a new line", async () => {
    const id = await createCart(testDb.db);
    await addItem(testDb.db, id, "p1", 2);
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items).toHaveLength(1);
    expect(cart?.items[0].quantity).toBe(2);
  });

  it("addItem increments quantity if line exists", async () => {
    const id = await createCart(testDb.db);
    await addItem(testDb.db, id, "p1", 1);
    await addItem(testDb.db, id, "p1", 3);
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items[0].quantity).toBe(4);
  });

  it("removeItem deletes the line", async () => {
    const id = await createCart(testDb.db);
    await addItem(testDb.db, id, "p1", 1);
    await removeItem(testDb.db, id, "p1");
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items).toHaveLength(0);
  });

  it("updateQuantity sets exact value", async () => {
    const id = await createCart(testDb.db);
    await addItem(testDb.db, id, "p1", 1);
    await updateQuantity(testDb.db, id, "p1", 5);
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items[0].quantity).toBe(5);
  });

  it("updateQuantity to 0 removes the line", async () => {
    const id = await createCart(testDb.db);
    await addItem(testDb.db, id, "p1", 1);
    await updateQuantity(testDb.db, id, "p1", 0);
    const cart = await getCartWithItems(testDb.db, id);
    expect(cart?.items).toHaveLength(0);
  });

  it("getCartWithItems returns null for unknown cart", async () => {
    const cart = await getCartWithItems(testDb.db, "no-such-cart");
    expect(cart).toBeNull();
  });
});
