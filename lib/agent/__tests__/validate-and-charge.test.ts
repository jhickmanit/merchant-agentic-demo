import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { categories, products, agents as agentsTable, orders } from "@/db/schema";
import { addItem, createCart } from "@/lib/cart";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { MockKyaPayProvider } from "@/lib/payments/mock/kyapay";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { mintTestKeypair } from "@/lib/payments/__tests__/helpers";
import { mintKyaToken } from "@/lib/payments/mint";

const ISSUER = "http://test-issuer";
const AUDIENCE = "merchant-agentic-demo";

async function setup(args: { spendCapCents?: number | null } = {}) {
  const testDb = freshTestDb();
  testDb.db.insert(categories).values([{ slug: "a", name: "A", blurb: "" }]).run();
  testDb.db.insert(products).values([
    { id: "p1", slug: "p1", name: "Tee", description: "", priceCents: 5000, imageUrl: "x", categorySlug: "a" },
  ]).run();
  const { publicKey, privateKey, publicJwk } = await mintTestKeypair();
  const kyaPay = new MockKyaPayProvider({
    publicKey, publicJwk,
    issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
  });
  const identity = new MemoryIdentityProvider();
  const permission = new MemoryPermissionProvider();
  const owner = await identity.createUser({ email: "alice@example.com" });
  const agent = await identity.createAgent({ displayName: "Shoppy", ownerIdentityId: owner.id, agentType: "shopping" });
  testDb.db.insert(agentsTable).values({
    id: agent.id, displayName: agent.displayName, ownerUserId: owner.id,
    agentType: "shopping", hydraClientId: "hydra-x",
    spendCapCents: args.spendCapCents === undefined ? 100000 : args.spendCapCents,
  }).run();
  const cartId = await createCart(testDb.db);
  await addItem(testDb.db, cartId, "p1", 1);
  return { testDb, kyaPay, privateKey, identity, permission, owner, agent, cartId };
}

describe("validateAndCharge (Phase 6 real impl)", () => {
  it("happy path: writes order, charges, decrements cap", async () => {
    const s = await setup({ spendCapCents: 100000 });
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token,
      cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(200);
    expect(result.body.orderId).toBeTruthy();
    const order = await s.testDb.db.query.orders.findFirst({ where: eq(orders.id, result.body.orderId as string) });
    expect(order?.paymentMethod).toBe("kyapay");
    expect(order?.skyfireChargeId).toMatch(/^mock-charge-/);
    const agentRow = await s.testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, s.agent.id) });
    expect(agentRow?.spendCapCents).toBe(95000);
  });

  it("rejects expired token", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, ttlSeconds: -100,
      issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE, privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("kya_invalid");
  });

  it("rejects when amount exceeds spend cap", async () => {
    const s = await setup({ spendCapCents: 1000 });
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("spend_cap_exceeded");
  });

  it("rejects hid.email mismatch", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "wrong@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("hid_mismatch");
  });

  it("rejects aid.id mismatch", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: "different-agent", agentName: "Other", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("aid_mismatch");
  });

  it("rejects amount mismatch with cart total", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 99999, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("amount_mismatch");
  });
});
