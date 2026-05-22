import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { categories, products, agents as agentsTable, orders } from "@/db/schema";
import { addItem, createCart } from "@/lib/cart";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import {
  bootstrapSkyfireAgent,
  _clearBridgeCacheForTests,
} from "@/lib/agent/skyfire-bridge";
import { MockKyaPayProvider } from "@/lib/payments/mock/kyapay";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { mintTestKeypair } from "@/lib/payments/__tests__/helpers";
import { mintKyaToken } from "@/lib/payments/mint";
import type { BootstrapResult } from "@/lib/oauth/bootstrap";
import type { KyaPayClaims } from "@/lib/payments/types";

/**
 * Integration-style test for the Phase 10 "flow 7" seam: a Bose-style request
 * arrives with only a Skyfire-attested KYA, the bridge bootstraps a Hydra
 * delegated token, and the resulting DelegationClaims flow into
 * validateAndCharge exactly as if a Hydra bearer had been presented up front.
 *
 * Mocks the Hydra round-trip (bootstrap + introspect) — those are exercised
 * by their own unit tests. What this proves is the *wiring*: bridge result →
 * ctx shape → validateAndCharge writes an order with the correct payment
 * method and a populated mandate panel.
 */

const ISSUER = "http://test-issuer";
const AUDIENCE = "merchant-agentic-demo";
const AGENT_ID = "414496a0-9fbd-4f44-b4b3-d19d0727d559";
const OWNER_EMAIL = "flow7-test@example.com";

async function setup() {
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
  const cartId = await createCart(testDb.db);
  await addItem(testDb.db, cartId, "p1", 1);

  // Pretend the bootstrap endpoint returned a Hydra access token.
  const bootstrap = async (): Promise<BootstrapResult> => ({
    access_token: "ory_at_flow7_fake",
    expires_in: 3600,
    scope: "offline_access openid",
    token_type: "Bearer",
  });

  // Pretend Hydra introspected the token back into delegated claims. Reads
  // the *actual* auto-provisioned owner id at call time (ensureAgentAndOwner
  // runs before introspect in the bridge), so delegation_sub_mismatch
  // doesn't trip — just like a real Hydra round-trip would stamp the right
  // subject after our /oauth/login app accepted the login.
  const introspect = async (): Promise<Record<string, unknown>> => {
    const provisionedOwner = await identity.getByEmail(OWNER_EMAIL);
    return {
      active: true,
      sub: provisionedOwner?.id ?? "owner-not-yet-provisioned",
      ext: {
        act: { sub: AGENT_ID, agent_type: "shopping", kya_jti: "jti-flow7" },
        authorization_details: [
          {
            type: "agent_purchase",
            actions: ["purchase"],
            max_amount: 10_000,
          },
        ],
      },
    };
  };

  return {
    testDb,
    kyaPay,
    privateKey,
    identity,
    permission,
    cartId,
    deps: {
      db: testDb.db,
      identity,
      permission,
      bootstrap,
      introspect,
      bridgeClientId: "test-bridge-id",
      bridgeClientSecret: "test-bridge-secret",
    },
  };
}

describe("Phase 10 — Skyfire bridge → validateAndCharge", () => {
  beforeEach(() => {
    _clearBridgeCacheForTests();
  });

  it("KYA-only request bootstraps + writes a kyapay order with delegation claims", async () => {
    const s = await setup();

    const kyaJwt = await mintKyaToken({
      agentId: AGENT_ID,
      agentName: "Bose Visa Demo Agent",
      userEmail: OWNER_EMAIL,
      amountCents: 5000,
      issuer: ISSUER,
      audience: AUDIENCE,
      sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });

    // 1. The kya-header / route handler logic happens before us; simulate
    //    that by verifying the KYA ourselves and feeding claims into the bridge.
    const verified = await s.kyaPay.verify(kyaJwt);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const bridged = await bootstrapSkyfireAgent(kyaJwt, verified.claims, s.deps);

    // Bridge auto-provisioned the owner + agent and bootstrapped a token.
    expect(bridged.bootstrapped).toBe(true);
    expect(bridged.accessToken).toBe("ory_at_flow7_fake");
    expect(bridged.agentId).toBe(AGENT_ID);
    expect(bridged.delegationClaims.act.sub).toBe(AGENT_ID);
    expect(bridged.delegationClaims.authorization_details[0]?.type).toBe(
      "agent_purchase",
    );

    // Auto-provision side-effect: agents row exists with the bridge sentinel.
    const agentRow = await s.testDb.db.query.agents.findFirst({
      where: eq(agentsTable.id, AGENT_ID),
    });
    expect(agentRow?.hydraClientId).toBe("skyfire-attested");
    expect(agentRow?.ownerUserId).toBe(bridged.ownerUserId);

    // 2. Feed the bridge result into validateAndCharge — same ctx shape as
    //    if a Hydra bearer had been presented in the Authorization header.
    const result = await validateAndCharge({
      kyaJwt,
      cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: {
        agentId: bridged.agentId,
        ownerUserId: bridged.ownerUserId,
        cartId: s.cartId,
        delegationClaims: bridged.delegationClaims,
      },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });

    expect(result.status).toBe(200);
    expect(result.body.orderId).toBeTruthy();

    const order = await s.testDb.db.query.orders.findFirst({
      where: eq(orders.id, result.body.orderId as string),
    });
    expect(order?.paymentMethod).toBe("kyapay");
    expect(order?.skyfireChargeId).toMatch(/^mock-charge-/);
    expect(order?.userId).toBe(bridged.ownerUserId);

    // KYA claims persisted for the /orders/<id> mandate panel.
    expect(order?.kyaClaimsJson).toBeTruthy();
    const persisted = JSON.parse(order!.kyaClaimsJson!) as KyaPayClaims;
    expect(persisted.agentId).toBe(AGENT_ID);
    expect(persisted.hid.email).toBe(OWNER_EMAIL);
  });

  it("second KYA-only request in the same session reuses the bootstrap (cache hit)", async () => {
    const s = await setup();
    let bootstrapCalls = 0;
    s.deps.bootstrap = async () => {
      bootstrapCalls++;
      return {
        access_token: `ory_at_call_${bootstrapCalls}`,
        expires_in: 3600,
        scope: "offline_access openid",
        token_type: "Bearer",
      };
    };

    const kyaJwt = await mintKyaToken({
      agentId: AGENT_ID,
      agentName: "Bose Visa Demo Agent",
      userEmail: OWNER_EMAIL,
      amountCents: 5000,
      issuer: ISSUER,
      audience: AUDIENCE,
      sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const verified = await s.kyaPay.verify(kyaJwt);
    if (!verified.ok) throw new Error("unreachable");

    const first = await bootstrapSkyfireAgent(kyaJwt, verified.claims, s.deps);
    const second = await bootstrapSkyfireAgent(kyaJwt, verified.claims, s.deps);

    expect(first.bootstrapped).toBe(true);
    expect(second.bootstrapped).toBe(false);
    expect(second.accessToken).toBe(first.accessToken);
    expect(bootstrapCalls).toBe(1);
  });
});
