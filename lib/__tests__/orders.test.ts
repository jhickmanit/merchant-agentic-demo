import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { categories, products } from "@/db/schema";
import { addItem, createCart } from "@/lib/cart";
import { createOrderFromCart, getOrderById, listOrdersForCart } from "@/lib/orders";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";

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
    const orderId = await createOrderFromCart(testDb.db, cartId, "user-test", "stub");
    const order = await getOrderById(testDb.db, orderId);
    expect(order?.paymentMethod).toBe("stub");
    expect(order?.subtotalCents).toBe(6500 * 2 + 2900);
    expect(order?.items).toHaveLength(2);
  });

  it("createOrderFromCart throws on empty cart", async () => {
    const cartId = await createCart(testDb.db);
    await expect(createOrderFromCart(testDb.db, cartId, "user-test", "stub")).rejects.toThrow();
  });

  it("listOrdersForCart returns descending by createdAt", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 1);
    const o1 = await createOrderFromCart(testDb.db, cartId, "user-test", "stub");
    await addItem(testDb.db, cartId, "p2", 1);
    const o2 = await createOrderFromCart(testDb.db, cartId, "user-test", "stub");
    const list = await listOrdersForCart(testDb.db, cartId);
    expect(list.map((o) => o.id)).toEqual([o2, o1]);
  });
});

describe("createOrderFromCart writes Keto tuples", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  let perm: MemoryPermissionProvider;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
    perm = new MemoryPermissionProvider();
  });

  it("writes both owner and view tuples on order create", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 1);
    const orderId = await createOrderFromCart(testDb.db, cartId, "user-1", "stub", { permissions: perm });

    const tuples = await perm.listForObject("Order", orderId);
    const owner = tuples.find((t) => t.relation === "owner");
    const view = tuples.find((t) => t.relation === "view");

    expect(owner?.subject).toBe("User:user-1");
    expect(view?.subject).toBe("User:user-1");
  });

  it("order is readable via permission.check after creation", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 1);
    const orderId = await createOrderFromCart(testDb.db, cartId, "user-1", "stub", { permissions: perm });

    const allowed = await perm.check({
      namespace: "Order",
      object: orderId,
      relation: "view",
      subject: "User:user-1",
    });
    expect(allowed).toBe(true);
  });

  it("does not write tuples when permissions opt is omitted", async () => {
    const cartId = await createCart(testDb.db);
    await addItem(testDb.db, cartId, "p1", 1);
    const orderId = await createOrderFromCart(testDb.db, cartId, "user-1", "stub");

    const tuples = await perm.listForObject("Order", orderId);
    expect(tuples).toHaveLength(0);
  });
});
