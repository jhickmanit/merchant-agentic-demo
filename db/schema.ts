import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

export const categories = sqliteTable("categories", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  blurb: text("blurb").notNull(),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  imageUrl: text("image_url").notNull(),
  categorySlug: text("category_slug")
    .notNull()
    .references(() => categories.slug),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categorySlug],
    references: [categories.slug],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const carts = sqliteTable("carts", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // null for anonymous carts; populated in phase 2
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const cartItems = sqliteTable(
  "cart_items",
  {
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cartId, t.productId] })]
);

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  cartId: text("cart_id").references(() => carts.id),
  userId: text("user_id"),                       // null for anonymous (phase 1)
  paymentMethod: text("payment_method").notNull(), // "stub" | "kyapay" (phase 6)
  paymentTokenJti: text("payment_token_jti"),     // populated in phase 6
  skyfireChargeId: text("skyfire_charge_id"),     // populated in phase 6
  subtotalCents: integer("subtotal_cents").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const orderItems = sqliteTable(
  "order_items",
  {
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    priceCentsAtPurchase: integer("price_cents_at_purchase").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.productId] })]
);

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  agentType: text("agent_type", { enum: ["shopping", "research", "general"] }).notNull(),
  hydraClientId: text("hydra_client_id").notNull(),
  spendCapCents: integer("spend_cap_cents"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  allowedMerchantsJson: text("allowed_merchants_json"),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));
