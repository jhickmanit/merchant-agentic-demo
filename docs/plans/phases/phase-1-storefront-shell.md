# Phase 1 — Storefront Shell (Anonymous Browsing, No Auth Yet)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A functional anonymous-shopping experience. Visitors can browse a seeded catalog of outdoor goods, add items to a cookie-backed cart, and "check out" with a stub payment method (writes an order, no real payment). Real auth arrives in Phase 2; real KYAPay arrives in Phase 6.

**Architecture:** Next.js 16 App Router. Drizzle + SQLite for catalog/cart/order persistence with a lazy DB client. Anonymous cart identified by a UUID stored in a plain `cart_id` cookie (sealing deferred to Phase 2 when sessions arrive). Catalog seeded from a static product list with Lorem Picsum images. shadcn/ui components for layout, header, cards, sheet, and dialog.

**Tech Stack:** carry-over from Phase 0 — Next.js 16, React 19, Tailwind v4, shadcn/ui (`base-nova`), Drizzle + better-sqlite3, Vitest, Playwright. New: `nanoid` for cart IDs, `zod` for input validation on API routes, `@faker-js/faker` for seed-time content generation.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 0 complete (17 commits on `main`, all green).
- Working directory clean, on `main`.
- `eval "$(fnm env --use-on-cd)"` activates Node 25.9.0 via `.node-version`.

**Standing preamble for every task** — run before any node/pnpm command:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```
**Never run `git checkout <sha>`** or anything that detaches HEAD. Stay on `main` throughout.

---

## File Structure (created/modified by this plan)

```
.
├── app/
│   ├── layout.tsx                        (modified — wraps in <Header />)
│   ├── page.tsx                          (rewritten — category grid)
│   ├── c/[category]/page.tsx             (new — category listing)
│   ├── p/[slug]/page.tsx                 (new — product detail)
│   ├── cart/page.tsx                     (new — cart view)
│   ├── checkout/page.tsx                 (new — stub checkout)
│   ├── orders/page.tsx                   (new — order list, anonymous shows current session's orders)
│   ├── orders/[id]/page.tsx              (new — order detail)
│   └── api/
│       ├── cart/items/route.ts           (new — POST add, DELETE remove, PATCH qty)
│       └── checkout/route.ts             (new — POST stub checkout)
├── components/
│   ├── header.tsx                        (new)
│   ├── product-card.tsx                  (new)
│   ├── product-grid.tsx                  (new)
│   ├── cart-sheet.tsx                    (new — slide-out cart preview)
│   ├── cart-line-item.tsx                (new)
│   ├── checkout-form.tsx                 (new)
│   ├── add-to-cart-button.tsx            (new)
│   └── theme-toggle.tsx                  (new — dark mode)
├── lib/
│   ├── cart-math.ts                      (modified — extend with line-item helpers)
│   ├── cart-cookie.ts                    (new — cart_id cookie read/write/init)
│   ├── cart.ts                           (new — cart repo: get, addItem, removeItem, updateQty)
│   ├── catalog.ts                        (new — product repo: list, getBySlug, listByCategory)
│   ├── orders.ts                         (new — order repo: create, getById, listForCart)
│   ├── format.ts                         (new — currency / quantity formatters)
│   └── __tests__/
│       ├── cart-math.test.ts             (modified — add line-item tests)
│       ├── cart-cookie.test.ts           (new)
│       ├── catalog.test.ts               (new — integration test against in-memory SQLite)
│       └── cart.test.ts                  (new — integration test)
├── db/
│   ├── index.ts                          (modified — lazy getDb())
│   ├── schema.ts                         (rewritten — products, categories, carts, cart_items, orders, order_items, agents stub)
│   ├── seed.ts                           (new — populate 30 products + 5 categories)
│   └── migrations/                       (regenerated — new schema)
├── e2e/
│   ├── smoke.spec.ts                     (modified — landing page now has category grid)
│   ├── browse.spec.ts                    (new — browse → product → add-to-cart)
│   └── checkout.spec.ts                  (new — full cart → checkout → order flow)
├── public/                               (cleanup — remove unused next.svg etc.)
└── package.json                          (modified — add nanoid, zod, @faker-js/faker, db:seed script)
```

---

## Task 1: Phase 0 follow-ups — lazy DB init + scaffold cleanup

**Files:**
- Modify: `db/index.ts`
- Modify: `app/page.tsx` (just to verify no regression after layout changes in later tasks)
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`

- [ ] **Step 1: Lazy `getDb()` implementation**

Replace `db/index.ts` with EXACTLY:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  _sqlite = new Database(process.env.DATABASE_URL ?? "./local.db");
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb() {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}

export type DB = ReturnType<typeof getDb>;
```

Rationale (carry-over from Phase 0 final review): top-level `new Database()` opened the SQLite file at module import time, which would create a stray `./local.db` during Vitest runs that import anything from `db/`. Lazy init delays the open until first use.

- [ ] **Step 2: Delete unused scaffold SVGs**

```bash
rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
ls public/  # should be empty or only contain favicon.ico-style files
```

- [ ] **Step 3: Verify typecheck still passes**

```bash
pnpm typecheck
```

Exit 0.

- [ ] **Step 4: Verify tests still pass**

```bash
pnpm test 2>&1 | tail -3
pnpm test:e2e 2>&1 | tail -5
```

All pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: lazy db init and remove unused scaffold svgs"
git log --oneline -3
git status -sb
```

---

## Task 2: Install Phase 1 deps + add `db:seed` script

**Files:**
- Modify: `package.json` (deps + script)
- Modify: `pnpm-workspace.yaml` (if any new package triggers build approval)

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add nanoid zod
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D @faker-js/faker tsx
```

`tsx` lets us run TypeScript directly (used for the seed script).

If pnpm 11 prompts for build approvals on any of these, add them to `pnpm-workspace.yaml` `allowBuilds` and re-run.

- [ ] **Step 3: Add `db:seed` script to `package.json`**

In the `scripts` block, add:
```json
"db:seed": "tsx db/seed.ts"
```

Preserve all existing scripts.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: install nanoid, zod, @faker-js/faker, tsx for phase 1"
```

---

## Task 3: Drizzle schema for products + categories

**Files:**
- Rewrite: `db/schema.ts` (drops the `_placeholder` table)

- [ ] **Step 1: Replace `db/schema.ts` with the products/categories portion**

```ts
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
```

- [ ] **Step 2: Drop the old placeholder migration**

```bash
rm -rf db/migrations
```

We'll regenerate after the full schema is in place (Task 6).

- [ ] **Step 3: Typecheck**

`pnpm typecheck` exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): products and categories schema"
```

---

## Task 4: Drizzle schema for carts + cart_items

**Files:**
- Modify: `db/schema.ts` (append cart tables)

- [ ] **Step 1: Append the cart-related tables to `db/schema.ts`**

After the existing definitions, add:

```ts
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
```

- [ ] **Step 2: Typecheck**

`pnpm typecheck` exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): carts and cart_items schema"
```

---

## Task 5: Drizzle schema for orders + order_items + agents stub

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Append to `db/schema.ts`**

```ts
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

// stub for phase 4 — not used in phase 1
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ownerUserId: text("owner_user_id"),
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
```

- [ ] **Step 2: Typecheck**

`pnpm typecheck` exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): orders, order_items, and agents stub schema"
```

---

## Task 6: Generate and apply the full migration

**Files:**
- Create: `db/migrations/0000_*.sql` (auto-generated)

- [ ] **Step 1: Generate migration**

```bash
pnpm db:generate
ls db/migrations/
cat db/migrations/0000_*.sql
```

Expected: one SQL file containing CREATE TABLE statements for categories, products, carts, cart_items, orders, order_items, agents (and meta files).

- [ ] **Step 2: Apply to local SQLite**

```bash
rm -f local.db
pnpm db:migrate
sqlite3 local.db ".tables"
```

Expected: prints all 7 table names. If `sqlite3` isn't available, use:
```bash
node -e "const db = require('better-sqlite3')('./local.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());"
```

- [ ] **Step 3: Commit migration**

```bash
git add db/migrations/ local.db 2>/dev/null || git add db/migrations/
# local.db is gitignored; only migrations should be added
git status -sb
git commit -m "feat(db): generate migration for full phase-1 schema"
```

---

## Task 7: Seed script

**Files:**
- Create: `db/seed.ts`
- Create: `db/seed-data.ts` (static product list — keeps `seed.ts` short)

- [ ] **Step 1: Author `db/seed-data.ts`**

This file contains the curated 30 products + 5 categories. Use this exact content (don't generate dynamically — we want reproducible seeds):

```ts
export const CATEGORIES = [
  { slug: "apparel", name: "Apparel", blurb: "Layers, shells, base layers." },
  { slug: "footwear", name: "Footwear", blurb: "Trail runners, boots, sandals." },
  { slug: "packs", name: "Packs", blurb: "Daypacks, hauls, hydration." },
  { slug: "food", name: "Trail Food", blurb: "Bars, dehydrated meals, electrolytes." },
  { slug: "accessories", name: "Accessories", blurb: "Headlamps, knives, repair kits." },
];

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  categorySlug: string;
}

export const PRODUCTS: SeedProduct[] = [
  // apparel (6)
  { slug: "alpine-shell", name: "Alpine Shell Jacket", description: "3-layer waterproof shell. Pit zips, helmet-compatible hood, taped seams.", priceCents: 38900, categorySlug: "apparel" },
  { slug: "puffy-vest", name: "Puffy Vest", description: "650-fill down vest. Stuffs into its own pocket. Weighs 240g.", priceCents: 18900, categorySlug: "apparel" },
  { slug: "merino-tee", name: "Merino Tee", description: "150gsm merino wool. Breathes, doesn't stink, dries fast.", priceCents: 6500, categorySlug: "apparel" },
  { slug: "softshell-pant", name: "Softshell Pant", description: "Stretch softshell, articulated knees, gusseted crotch.", priceCents: 14900, categorySlug: "apparel" },
  { slug: "rain-pant", name: "Packable Rain Pant", description: "Side zips for layering. Packs to size of a soda can.", priceCents: 12900, categorySlug: "apparel" },
  { slug: "trucker-cap", name: "Trucker Cap", description: "Mesh back, snapback, embroidered logo.", priceCents: 2900, categorySlug: "apparel" },

  // footwear (5)
  { slug: "trail-runner-x", name: "Trail Runner X", description: "Vibram Megagrip outsole. 4mm drop. 290g per shoe.", priceCents: 16500, categorySlug: "footwear" },
  { slug: "approach-shoe", name: "Approach Shoe", description: "Sticky rubber climbing zone at toe. Reinforced upper.", priceCents: 17500, categorySlug: "footwear" },
  { slug: "leather-boot", name: "Leather Backpacking Boot", description: "Full-grain leather, waterproof membrane, all-day support.", priceCents: 27900, categorySlug: "footwear" },
  { slug: "camp-sandal", name: "Camp Sandal", description: "Foam footbed. Toe loop. For around camp and river crossings.", priceCents: 5900, categorySlug: "footwear" },
  { slug: "wool-sock-3pack", name: "Wool Hiking Sock — 3-pack", description: "Mid-weight merino crew. Lifetime guarantee.", priceCents: 4500, categorySlug: "footwear" },

  // packs (6)
  { slug: "summit-pack-20", name: "Summit Pack 20L", description: "Stripped-down daypack. 280g. Bungee front, ice axe loop.", priceCents: 8900, categorySlug: "packs" },
  { slug: "daypack-30", name: "Daypack 30L", description: "Frame sheet, hip belt, hydration sleeve, side pockets.", priceCents: 13900, categorySlug: "packs" },
  { slug: "weekend-pack-50", name: "Weekend Pack 50L", description: "For 1–3 night trips. Roll-top closure, removable lid.", priceCents: 24900, categorySlug: "packs" },
  { slug: "thru-hike-65", name: "Thru-Hike Pack 65L", description: "Ultralight haul-bag style. 1.1kg. 500D Ultra fabric.", priceCents: 32900, categorySlug: "packs" },
  { slug: "fanny-pack", name: "Trail Fanny Pack", description: "Two zip compartments, bottle pocket. Worn front or back.", priceCents: 3900, categorySlug: "packs" },
  { slug: "hydration-vest", name: "Hydration Vest 6L", description: "Two 500ml soft flasks included. Stretch storage pockets.", priceCents: 11900, categorySlug: "packs" },

  // food (6)
  { slug: "nut-butter-bar", name: "Nut Butter Bar — 12 pack", description: "300 calories of fat and protein per bar. Salted maple flavor.", priceCents: 2400, categorySlug: "food" },
  { slug: "dehydrated-curry", name: "Dehydrated Thai Curry Meal", description: "650 calories. Add boiling water, wait 10 minutes.", priceCents: 1500, categorySlug: "food" },
  { slug: "electrolyte-mix", name: "Electrolyte Mix — 30 servings", description: "1000mg sodium per serving. Lemon-lime flavor.", priceCents: 2900, categorySlug: "food" },
  { slug: "trail-mix-1lb", name: "Trail Mix — 1lb", description: "Almonds, cashews, raisins, dark chocolate. Resealable.", priceCents: 1100, categorySlug: "food" },
  { slug: "instant-coffee", name: "Instant Coffee — 10 packets", description: "Specialty single-origin. Dissolves in cold water.", priceCents: 1800, categorySlug: "food" },
  { slug: "energy-gel", name: "Energy Gel — 24 pack", description: "25g of carbs per gel. Mixed flavors.", priceCents: 4200, categorySlug: "food" },

  // accessories (7)
  { slug: "headlamp", name: "Headlamp 400 lumens", description: "Rechargeable USB-C. Red-light mode. IPX7.", priceCents: 7500, categorySlug: "accessories" },
  { slug: "pocket-knife", name: "Pocket Knife", description: "Locking blade, glass-filled nylon handle. 60g.", priceCents: 4900, categorySlug: "accessories" },
  { slug: "repair-kit", name: "Gear Repair Kit", description: "Tenacious Tape, patches, needle, dental floss, zip ties.", priceCents: 1900, categorySlug: "accessories" },
  { slug: "bear-spray", name: "Bear Spray", description: "10oz canister. EPA-approved. Holster included.", priceCents: 5500, categorySlug: "accessories" },
  { slug: "trekking-poles", name: "Carbon Trekking Poles — pair", description: "Z-fold, 110g per pole, cork grips.", priceCents: 14900, categorySlug: "accessories" },
  { slug: "first-aid-kit", name: "Wilderness First Aid Kit", description: "For 1–2 people, 3–5 days. Includes SAM splint.", priceCents: 6900, categorySlug: "accessories" },
  { slug: "water-filter", name: "Squeeze Water Filter", description: "Hollow-fiber. 0.1 micron. 1L/min flow rate.", priceCents: 3900, categorySlug: "accessories" },
];
```

Total: 5 categories + 30 products.

- [ ] **Step 2: Author `db/seed.ts`**

```ts
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
```

- [ ] **Step 3: Run the seed**

```bash
pnpm db:seed
```

Expected: prints "Seeding 5 categories and 30 products..." then "Seed complete.". Re-runnable (deletes + reinserts).

- [ ] **Step 4: Verify the data landed**

```bash
node -e "
  const db = require('better-sqlite3')('./local.db');
  console.log('categories:', db.prepare('SELECT COUNT(*) as n FROM categories').get());
  console.log('products:', db.prepare('SELECT COUNT(*) as n FROM products').get());
  console.log('sample:', db.prepare('SELECT slug, name, price_cents FROM products LIMIT 3').all());
"
```

Expected: 5 categories, 30 products, sample shows real names.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add db/seed.ts db/seed-data.ts
git commit -m "feat(db): seed script for 5 categories and 30 products"
```

---

## Task 8: Catalog repo + integration tests

**Files:**
- Create: `lib/catalog.ts`
- Create: `lib/__tests__/catalog.test.ts`

This task uses TDD: write tests first against an in-memory SQLite, then implement.

- [ ] **Step 1: Add a test helper for in-memory DB**

Create `lib/__tests__/helpers.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

export function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../db/migrations") });
  return { db, sqlite };
}
```

- [ ] **Step 2: Write the catalog tests (RED)**

Create `lib/__tests__/catalog.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests — must fail**

```bash
pnpm test 2>&1 | tail -15
```

Expected: FAIL with "Cannot find module '@/lib/catalog'".

- [ ] **Step 4: Implement `lib/catalog.ts` (GREEN)**

```ts
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
```

- [ ] **Step 5: Run tests — must pass**

```bash
pnpm test 2>&1 | tail -10
```

Expected: 7 passed (3 from cart-math + 4 new catalog tests).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add lib/catalog.ts lib/__tests__/catalog.test.ts lib/__tests__/helpers.ts
git commit -m "feat(catalog): list/get repo with TDD tests"
```

---

## Task 9: Cart cookie helper + tests

**Files:**
- Create: `lib/cart-cookie.ts`
- Create: `lib/__tests__/cart-cookie.test.ts`

The cart cookie stores just a UUID (the `carts.id`). Sealing/signing deferred to Phase 2.

- [ ] **Step 1: Write tests (RED)**

Create `lib/__tests__/cart-cookie.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCartIdFromCookie, CART_COOKIE_NAME, CART_COOKIE_MAX_AGE } from "@/lib/cart-cookie";

describe("cart cookie", () => {
  it("exports the cookie name 'cart_id'", () => {
    expect(CART_COOKIE_NAME).toBe("cart_id");
  });

  it("exports a 30-day max-age", () => {
    expect(CART_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });

  it("parseCartIdFromCookie returns null for empty input", () => {
    expect(parseCartIdFromCookie(undefined)).toBeNull();
    expect(parseCartIdFromCookie("")).toBeNull();
  });

  it("parseCartIdFromCookie rejects non-UUID-like values", () => {
    expect(parseCartIdFromCookie("not a cart id")).toBeNull();
    expect(parseCartIdFromCookie("short")).toBeNull();
  });

  it("parseCartIdFromCookie accepts nanoid-shaped values", () => {
    expect(parseCartIdFromCookie("abc123XYZ-_456")).toBe("abc123XYZ-_456");
  });
});
```

- [ ] **Step 2: Run tests — must fail**

`pnpm test 2>&1 | tail -10` — fails on missing module.

- [ ] **Step 3: Implement `lib/cart-cookie.ts` (GREEN)**

```ts
export const CART_COOKIE_NAME = "cart_id";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// nanoid alphabet: A-Z a-z 0-9 _ -
// We accept anything that's at least 8 chars of that alphabet.
const NANOID_RE = /^[A-Za-z0-9_-]{8,}$/;

export function parseCartIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  return NANOID_RE.test(raw) ? raw : null;
}
```

- [ ] **Step 4: Tests pass**

```bash
pnpm test 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add lib/cart-cookie.ts lib/__tests__/cart-cookie.test.ts
git commit -m "feat(cart): cookie name + parser helper"
```

---

## Task 10: Cart repo + integration tests

**Files:**
- Create: `lib/cart.ts`
- Modify: `lib/cart-math.ts` (add a `cartTotalFromLines()` helper that uses Product-bearing line items)
- Create: `lib/__tests__/cart.test.ts`
- Modify: `lib/__tests__/cart-math.test.ts` (add tests for new helper)

This task is large. Order steps so they stay TDD-shaped.

- [ ] **Step 1: Extend cart-math tests**

Append to `lib/__tests__/cart-math.test.ts`:

```ts
import { cartTotalFromLines, type CartLineWithProduct } from "@/lib/cart-math";

describe("cartTotalFromLines", () => {
  it("returns 0 for empty cart", () => {
    expect(cartTotalFromLines([])).toBe(0);
  });

  it("sums quantity × product.priceCents", () => {
    const lines: CartLineWithProduct[] = [
      { quantity: 2, product: { priceCents: 1999 } as any },
      { quantity: 3, product: { priceCents: 500 } as any },
    ];
    expect(cartTotalFromLines(lines)).toBe(1999 * 2 + 500 * 3);
  });
});
```

- [ ] **Step 2: Run — fails on missing export**

`pnpm test 2>&1 | tail -5`

- [ ] **Step 3: Extend `lib/cart-math.ts`**

Append:

```ts
export interface CartLineWithProduct {
  quantity: number;
  product: { priceCents: number };
}

export function cartTotalFromLines(lines: CartLineWithProduct[]): number {
  return lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
}
```

- [ ] **Step 4: cart-math tests pass**

`pnpm test 2>&1 | tail -5` — green.

- [ ] **Step 5: Write cart-repo tests (RED)**

Create `lib/__tests__/cart.test.ts`:

```ts
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
```

- [ ] **Step 6: Run — fails on missing module**

`pnpm test 2>&1 | tail -5`

- [ ] **Step 7: Implement `lib/cart.ts` (GREEN)**

```ts
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { carts, cartItems } from "@/db/schema";

export async function createCart(db: DB): Promise<string> {
  const id = nanoid(16);
  await db.insert(carts).values({ id });
  return id;
}

export async function getCartWithItems(db: DB, cartId: string) {
  const cart = await db.query.carts.findFirst({
    where: eq(carts.id, cartId),
    with: {
      items: {
        with: { product: true },
      },
    },
  });
  return cart ?? null;
}

export async function addItem(db: DB, cartId: string, productId: string, qty: number) {
  if (qty <= 0) throw new Error(`quantity must be > 0, got ${qty}`);
  const existing = await db.query.cartItems.findFirst({
    where: and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)),
  });
  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: existing.quantity + qty })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  } else {
    await db.insert(cartItems).values({ cartId, productId, quantity: qty });
  }
}

export async function removeItem(db: DB, cartId: string, productId: string) {
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
}

export async function updateQuantity(db: DB, cartId: string, productId: string, qty: number) {
  if (qty < 0) throw new Error(`quantity must be >= 0, got ${qty}`);
  if (qty === 0) {
    await removeItem(db, cartId, productId);
    return;
  }
  await db
    .update(cartItems)
    .set({ quantity: qty })
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
}
```

- [ ] **Step 8: Tests pass**

`pnpm test 2>&1 | tail -10` — all green.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(cart): repo with TDD tests for create/get/add/remove/updateQty"
```

---

## Task 11: Currency + formatting helper

**Files:**
- Create: `lib/format.ts`
- Create: `lib/__tests__/format.test.ts`

- [ ] **Step 1: Tests (RED)**

Create `lib/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCents } from "@/lib/format";

describe("formatCents", () => {
  it("formats 0", () => expect(formatCents(0)).toBe("$0.00"));
  it("formats 6500", () => expect(formatCents(6500)).toBe("$65.00"));
  it("formats 38999", () => expect(formatCents(38999)).toBe("$389.99"));
  it("formats 1", () => expect(formatCents(1)).toBe("$0.01"));
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `lib/format.ts`**

```ts
export function formatCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: formatCents helper with tests"
```

---

## Task 12: Header + layout shell

**Files:**
- Create: `components/header.tsx`
- Create: `components/theme-toggle.tsx`
- Modify: `app/layout.tsx`
- Add shadcn `dropdown-menu` for theme toggle

- [ ] **Step 1: Add shadcn components**

```bash
pnpm dlx shadcn@latest add sheet dropdown-menu --yes
```

Adds `components/ui/sheet.tsx` and `components/ui/dropdown-menu.tsx`.

- [ ] **Step 2: Install `next-themes` for dark mode**

```bash
pnpm add next-themes
```

- [ ] **Step 3: Create `components/theme-toggle.tsx`**

```tsx
"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">Theme</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Create `components/header.tsx`**

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";

async function cartItemCount(): Promise<number> {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return 0;
  const cart = await getCartWithItems(getDb(), cartId);
  if (!cart) return 0;
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

export async function Header() {
  const count = await cartItemCount();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          TrailPeak
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
            Orders
          </Link>
          <ThemeToggle />
          <Link href="/cart">
            <Button variant="default" size="sm">
              Cart{count > 0 ? ` · ${count}` : ""}
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Wrap layout with `<ThemeProvider>` and `<Header>`**

Modify `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Header } from "@/components/header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TrailPeak — Outdoor Outfitter",
  description: "Ory × Skyfire KYAPay reference integration.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Header />
          <main className="flex-1">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Verify dev server**

```bash
pnpm dev &
DEV_PID=$!
sleep 7
curl -sf http://localhost:3000 | grep -q "TrailPeak" && echo "header OK"
kill $DEV_PID
```

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(ui): header with cart badge, dark-mode toggle, branded wordmark"
```

---

## Task 13: Product browsing pages

**Files:**
- Modify: `app/page.tsx` (rewrite — category grid)
- Create: `app/c/[category]/page.tsx`
- Create: `app/p/[slug]/page.tsx`
- Create: `components/product-card.tsx`
- Create: `components/product-grid.tsx`
- Create: `components/add-to-cart-button.tsx`

- [ ] **Step 1: ProductCard**

Create `components/product-card.tsx`:

```tsx
import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/format";

interface Props {
  slug: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  category: { name: string };
}

export function ProductCard({ slug, name, priceCents, imageUrl, category }: Props) {
  return (
    <Link href={`/p/${slug}`} className="block">
      <Card className="overflow-hidden transition-transform hover:scale-[1.02]">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        </div>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{name}</CardTitle>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{category.name}</p>
        </CardHeader>
        <CardFooter className="pt-0">
          <span className="text-lg font-semibold">{formatCents(priceCents)}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
```

Add shadcn `card` if not already present:
```bash
pnpm dlx shadcn@latest add card --yes
```

- [ ] **Step 2: ProductGrid**

Create `components/product-grid.tsx`:

```tsx
import { ProductCard } from "./product-card";

interface Product {
  slug: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  category: { name: string };
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.slug} {...p} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Landing page — category grid + featured products**

Rewrite `app/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/db";
import { listCategories, listProducts } from "@/lib/catalog";
import { ProductGrid } from "@/components/product-grid";

export default async function Home() {
  const db = getDb();
  const [cats, allProducts] = await Promise.all([
    listCategories(db),
    listProducts(db),
  ]);
  const featured = allProducts.slice(0, 8);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-12">
      <section>
        <h1 className="text-4xl font-bold tracking-tight">Outdoor gear for trail and trip.</h1>
        <p className="mt-2 text-muted-foreground">
          Hand-picked apparel, footwear, packs, food, and accessories.
        </p>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Shop by category</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cats.map((c) => (
            <Link
              key={c.slug}
              href={`/c/${c.slug}`}
              className="rounded-lg border bg-card p-4 text-center hover:bg-accent"
            >
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.blurb}</div>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Featured</h2>
        <ProductGrid products={featured} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Category page**

Create `app/c/[category]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { listByCategory, listCategories } from "@/lib/catalog";
import { ProductGrid } from "@/components/product-grid";

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const db = getDb();
  const cats = await listCategories(db);
  const cat = cats.find((c) => c.slug === category);
  if (!cat) notFound();
  const items = await listByCategory(db, category);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{cat.name}</h1>
        <p className="mt-1 text-muted-foreground">{cat.blurb}</p>
      </header>
      <ProductGrid products={items} />
    </div>
  );
}
```

- [ ] **Step 5: Product detail page**

Create `app/p/[slug]/page.tsx`:

```tsx
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
```

- [ ] **Step 6: AddToCartButton (client component, calls POST /api/cart/items)**

Create `components/add-to-cart-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AddToCartButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      if (!res.ok) {
        setError("Failed to add to cart");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={onClick} disabled={pending} size="lg">
        {pending ? "Adding…" : "Add to cart"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 7: Visual smoke test**

(Cart API doesn't exist yet — the button will 404. That's expected; Task 14 builds it.)

```bash
pnpm dev &
DEV_PID=$!
sleep 7
curl -sf http://localhost:3000 | grep -q "Shop by category" && echo "home OK"
curl -sf http://localhost:3000/c/apparel | grep -q "Apparel" && echo "category OK"
curl -sf http://localhost:3000/p/merino-tee | grep -q "Merino Tee" && echo "product OK"
kill $DEV_PID
```

All three OK.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(ui): home, category, and product detail pages"
```

---

## Task 14: Cart API + cart page

**Files:**
- Create: `app/api/cart/items/route.ts`
- Create: `app/cart/page.tsx`
- Create: `components/cart-line-item.tsx`

- [ ] **Step 1: API route — POST add, DELETE remove, PATCH update**

Create `app/api/cart/items/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { addItem, createCart, removeItem, updateQuantity } from "@/lib/cart";
import {
  CART_COOKIE_NAME,
  CART_COOKIE_MAX_AGE,
  parseCartIdFromCookie,
} from "@/lib/cart-cookie";

const AddSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive() });
const RemoveSchema = z.object({ productId: z.string().min(1) });
const UpdateSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().nonnegative() });

async function ensureCartId(): Promise<{ id: string; isNew: boolean }> {
  const store = await cookies();
  const raw = store.get(CART_COOKIE_NAME)?.value;
  const existing = parseCartIdFromCookie(raw);
  if (existing) return { id: existing, isNew: false };
  const id = await createCart(getDb());
  return { id, isNew: true };
}

function setCartCookie(res: NextResponse, id: string) {
  res.cookies.set(CART_COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { id, isNew } = await ensureCartId();
  await addItem(getDb(), id, parsed.data.productId, parsed.data.quantity);
  const res = NextResponse.json({ ok: true, cartId: id });
  if (isNew) setCartCookie(res, id);
  return res;
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = RemoveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 404 });
  await removeItem(getDb(), cartId, parsed.data.productId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 404 });
  await updateQuantity(getDb(), cartId, parsed.data.productId, parsed.data.quantity);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: CartLineItem component (client)**

Create `components/cart-line-item.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format";

interface Props {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string;
  priceCents: number;
  quantity: number;
}

export function CartLineItem({ productId, name, slug, imageUrl, priceCents, quantity }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function update(qty: number) {
    startTransition(async () => {
      await fetch("/api/cart/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty }),
      });
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await fetch("/api/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      router.refresh();
    });
  }

  return (
    <div className="flex gap-4 border-b py-4 last:border-b-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={name} className="h-20 w-20 rounded object-cover" />
      <div className="flex-1 space-y-1">
        <a href={`/p/${slug}`} className="font-medium hover:underline">{name}</a>
        <div className="text-sm text-muted-foreground">{formatCents(priceCents)} each</div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={pending || quantity <= 1} onClick={() => update(quantity - 1)}>−</Button>
          <span className="w-8 text-center text-sm">{quantity}</span>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => update(quantity + 1)}>+</Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>Remove</Button>
        </div>
      </div>
      <div className="text-right font-semibold">{formatCents(priceCents * quantity)}</div>
    </div>
  );
}
```

- [ ] **Step 3: Cart page**

Create `app/cart/page.tsx`:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { cartTotalFromLines } from "@/lib/cart-math";
import { formatCents } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CartLineItem } from "@/components/cart-line-item";

export default async function CartPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
  const items = cart?.items ?? [];
  const total = cartTotalFromLines(items);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Your cart is empty.{" "}
          <Link href="/" className="text-foreground underline">Keep browsing</Link>.
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            {items.map((item) => (
              <CartLineItem
                key={item.productId}
                productId={item.productId}
                slug={item.product.slug}
                name={item.product.name}
                imageUrl={item.product.imageUrl}
                priceCents={item.product.priceCents}
                quantity={item.quantity}
              />
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-lg font-semibold">Total</div>
            <div className="text-2xl font-bold">{formatCents(total)}</div>
          </div>
          <Link href="/checkout">
            <Button className="w-full" size="lg">Check out</Button>
          </Link>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 7
# create a cart and add an item
curl -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST http://localhost:3000/api/cart/items \
  -H "Content-Type: application/json" \
  -d '{"productId":"<id-of-merino-tee>","quantity":1}' \
  2>&1 | tail -5
# Actual product IDs are nanoid-generated; for smoke test, query the db:
PRODUCT_ID=$(node -e "const db=require('better-sqlite3')('./local.db'); console.log(db.prepare('SELECT id FROM products LIMIT 1').get().id)")
curl -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST http://localhost:3000/api/cart/items \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}"
echo
curl -s -b /tmp/cookies.txt http://localhost:3000/cart | grep -E "(Total|Your cart)" | head -3
kill $DEV_PID
```

Expected: API returns `{"ok":true, ...}`; `/cart` shows a non-empty cart with a Total line.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(cart): /api/cart/items route + cart page with line-item controls"
```

---

## Task 15: Checkout stub + orders pages

**Files:**
- Create: `app/checkout/page.tsx`
- Create: `app/api/checkout/route.ts`
- Create: `app/orders/page.tsx`
- Create: `app/orders/[id]/page.tsx`
- Create: `components/checkout-form.tsx`
- Create: `lib/orders.ts`
- Create: `lib/__tests__/orders.test.ts`

- [ ] **Step 1: Orders repo + tests (TDD)**

Create `lib/__tests__/orders.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — fails**

`pnpm test 2>&1 | tail -10`

- [ ] **Step 3: Implement `lib/orders.ts`**

```ts
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { orders, orderItems, cartItems } from "@/db/schema";

export async function createOrderFromCart(
  db: DB,
  cartId: string,
  paymentMethod: "stub" | "kyapay",
): Promise<string> {
  const lines = await db.query.cartItems.findMany({
    where: eq(cartItems.cartId, cartId),
    with: { product: true },
  });
  if (lines.length === 0) throw new Error("Cannot create order from empty cart");

  const subtotal = lines.reduce(
    (sum, l) => sum + l.product.priceCents * l.quantity,
    0,
  );

  const id = nanoid(12);
  await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      id,
      cartId,
      paymentMethod,
      subtotalCents: subtotal,
    });
    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: id,
        productId: l.productId,
        quantity: l.quantity,
        priceCentsAtPurchase: l.product.priceCents,
      })),
    );
    // clear cart
    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
  });
  return id;
}

export async function getOrderById(db: DB, id: string) {
  const result = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      items: {
        with: { product: true },
      },
    },
  });
  return result ?? null;
}

export async function listOrdersForCart(db: DB, cartId: string) {
  return db.query.orders.findMany({
    where: eq(orders.cartId, cartId),
    orderBy: desc(orders.createdAt),
    with: { items: { with: { product: true } } },
  });
}
```

- [ ] **Step 4: Tests pass**

`pnpm test 2>&1 | tail -10` — all green (4 cart-math + 5 cart-cookie + 4 catalog + 7 cart + 4 format + 3 orders = 27 tests).

- [ ] **Step 5: Checkout API**

Create `app/api/checkout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { createOrderFromCart } from "@/lib/orders";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";

export async function POST() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 400 });
  try {
    const orderId = await createOrderFromCart(getDb(), cartId, "stub");
    return NextResponse.json({ ok: true, orderId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 6: CheckoutForm component**

Create `components/checkout-form.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CheckoutForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Checkout failed");
        return;
      }
      router.push(`/orders/${data.orderId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Demo checkout — no payment is taken. Auth and real payment arrive in later phases.
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Placing order…" : "Place stub order"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Checkout page**

Create `app/checkout/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { cartTotalFromLines } from "@/lib/cart-math";
import { formatCents } from "@/lib/format";
import { CheckoutForm } from "@/components/checkout-form";

export default async function CheckoutPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
  if (!cart || cart.items.length === 0) redirect("/cart");
  const total = cartTotalFromLines(cart.items);
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <section className="rounded-lg border">
        {cart.items.map((line) => (
          <div key={line.productId} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <span>
              {line.product.name} × {line.quantity}
            </span>
            <span className="font-medium">{formatCents(line.product.priceCents * line.quantity)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(total)}</span>
        </div>
      </section>
      <CheckoutForm />
    </div>
  );
}
```

- [ ] **Step 8: Orders list page**

Create `app/orders/page.tsx`:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { listOrdersForCart } from "@/lib/orders";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { formatCents } from "@/lib/format";

export default async function OrdersPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const orders = cartId ? await listOrdersForCart(getDb(), cartId) : [];
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No orders yet. Anonymous orders for this session show up here.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orders.map((o) => (
            <li key={o.id} className="px-4 py-3">
              <Link href={`/orders/${o.id}`} className="flex items-center justify-between hover:underline">
                <span className="font-mono text-sm">{o.id}</span>
                <span className="font-semibold">{formatCents(o.subtotalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Order detail page**

Create `app/orders/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getOrderById } from "@/lib/orders";
import { formatCents } from "@/lib/format";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderById(getDb(), id);
  if (!order) notFound();
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Order placed</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{order.id}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Payment: <span className="font-medium text-foreground">{order.paymentMethod}</span>
        </p>
      </header>
      <section className="rounded-lg border">
        {order.items.map((line) => (
          <div key={line.productId} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <span>{line.product.name} × {line.quantity}</span>
            <span className="font-medium">{formatCents(line.priceCentsAtPurchase * line.quantity)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(order.subtotalCents)}</span>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 10: Typecheck + lint + commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(checkout): stub checkout + orders list and detail pages"
```

---

## Task 16: Playwright e2e — full browse → cart → checkout flow

**Files:**
- Modify: `e2e/smoke.spec.ts` (update for new home page)
- Create: `e2e/browse.spec.ts`
- Create: `e2e/checkout.spec.ts`

The Phase 0 smoke test asserted "Get started" button which no longer exists. Update it.

- [ ] **Step 1: Update smoke**

Replace `e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("landing page renders categories and featured products", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Outdoor gear for trail/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured" })).toBeVisible();
});
```

- [ ] **Step 2: Browse spec**

Create `e2e/browse.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("browse category and product detail", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Apparel", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/c\/apparel/);
  await expect(page.getByRole("heading", { name: "Apparel" })).toBeVisible();
  // Click into a known seeded product
  await page.getByText("Merino Tee").first().click();
  await expect(page).toHaveURL(/\/p\/merino-tee/);
  await expect(page.getByRole("heading", { name: "Merino Tee" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();
});
```

- [ ] **Step 3: Checkout spec**

Create `e2e/checkout.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("add to cart, check out, see order", async ({ page }) => {
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());
  // navigate to cart
  await page.getByRole("link", { name: /Cart/ }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(page.getByText("Merino Tee")).toBeVisible();
  // check out
  await page.getByRole("link", { name: "Check out" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
});
```

- [ ] **Step 4: Run all e2e tests**

```bash
pnpm test:e2e 2>&1 | tail -10
```

Expected: 3 passed (smoke + browse + checkout).

If any fail, open `playwright-report/` for trace.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): browse + cart + checkout flows"
```

---

## Task 17: Update README, verify the whole shebang

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Local data" section to README**

Find the `## Setup` section in `README.md` and append a step:

```markdown
After `pnpm install`, run the database setup:

```bash
pnpm db:migrate
pnpm db:seed
```
```

This is documented but the README's current Setup block already has `pnpm db:generate`. Replace that line with the two above (`db:migrate` then `db:seed`).

Use Read + Edit on `README.md`. Find:
```
pnpm db:generate
```
Replace with:
```
pnpm db:migrate
pnpm db:seed
```

- [ ] **Step 2: Final verification — run the entire suite**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

All exit 0.

- [ ] **Step 3: Git state check**

```bash
git status -sb
git log --oneline | head -20
git branch --show-current
```

Tree clean. On main. ~35–40 commits total.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for phase 1 db migrate + seed"
```

---

## Final verification

- [ ] **Step 1: Full CI sequence locally**

```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test           # expect ~27 unit tests passing
pnpm test:e2e       # expect 3 e2e tests passing
./scripts/ory-setup/apply.sh
```

All exit 0.

- [ ] **Step 2: Manually verify the demo flow**

```bash
pnpm dev &
DEV_PID=$!
sleep 7
echo "Open http://localhost:3000 in a browser and verify:"
echo "  1. Landing page shows 5 categories and 8 featured products"
echo "  2. Click 'Apparel' → see 6 products"
echo "  3. Click 'Merino Tee' → product detail with image, price, add-to-cart"
echo "  4. Click Add to cart → header cart badge increments"
echo "  5. Click Cart → cart page shows the merino tee with quantity controls"
echo "  6. Click +/- → quantity updates"
echo "  7. Click Check out → checkout page shows total"
echo "  8. Click Place stub order → redirects to /orders/<id> with order details"
echo "  9. Click Orders in header → see the order in the list"
echo " 10. Toggle theme via dropdown → page switches between light/dark"
echo
echo "When done press enter to stop the dev server."
read
kill $DEV_PID
```

- [ ] **Step 3: Git tree**

```bash
git log --oneline | head -25
git status -sb
```

Clean, on main, ~35–40 commits.

---

## Phase 1 complete

End state:
- Anonymous shoppers can browse a 30-product catalog organized into 5 categories, add items to a cookie-backed cart, and "check out" with a stub payment that writes an order.
- The schema is in place for Phase 2 (users) and Phase 4+ (agents, orders linked to KYAPay).
- 27+ unit tests cover cart math, cookie parsing, catalog repo, cart repo, format helpers, and orders repo.
- 3 Playwright e2e tests cover landing, browse, and checkout flows.
- Dark mode toggle works.

**Next:** Phase 2 — Real Ory wiring. Replace the (nonexistent) anonymous-only auth with real Kratos sessions via Ory Account Experience; introduce `IdentityProvider`/`SessionProvider`/`PermissionProvider` abstractions with both `OryX` and `MemoryX` implementations; migrate anonymous carts to user-owned on sign-in. See [`phase-2-real-ory-identity.md`](./phase-2-real-ory-identity.md) (to be written when Phase 1 is complete).
