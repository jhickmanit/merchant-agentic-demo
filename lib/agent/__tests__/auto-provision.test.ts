import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { agents } from "@/db/schema";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { ensureAgentAndOwner } from "@/lib/agent/auto-provision";
import type { KyaPayClaims } from "@/lib/payments/types";

function makeClaims(overrides: Partial<KyaPayClaims> = {}): KyaPayClaims {
  return {
    iss: "https://app.skyfire.xyz",
    aud: "seller-uuid",
    jti: "jti-1",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    agentId: "414496a0-9fbd-4f44-b4b3-d19d0727d559",
    hid: { email: "user@example.com" },
    aid: { name: "Bose Visa Demo Agent" },
    ...overrides,
  };
}

async function setup() {
  const { db } = freshTestDb();
  const identity = new MemoryIdentityProvider();
  const permission = new MemoryPermissionProvider();
  return { db, identity, permission, deps: { db, identity, permission } };
}

describe("ensureAgentAndOwner", () => {
  it("creates both user and agent on first call", async () => {
    const { db, identity, permission, deps } = await setup();
    const r = await ensureAgentAndOwner(makeClaims(), deps);
    expect(r.createdOwner).toBe(true);
    expect(r.createdAgent).toBe(true);
    const user = await identity.getByEmail("user@example.com");
    expect(user?.id).toBe(r.ownerUserId);
    const row = db.query.agents.findFirst({ where: eq(agents.id, r.agentId) });
    expect((await row)?.displayName).toBe("Bose Visa Demo Agent");
    expect((await row)?.hydraClientId).toBe("skyfire-attested");
    expect((await row)?.spendCapCents).toBeNull();
    expect(
      await permission.check({
        namespace: "Agent",
        object: r.agentId,
        relation: "owner",
        subject: `User:${r.ownerUserId}`,
      }),
    ).toBe(true);
  });

  it("reuses existing user, creates new agent", async () => {
    const { identity, deps } = await setup();
    const existing = await identity.createUser({ email: "user@example.com" });
    const r = await ensureAgentAndOwner(makeClaims(), deps);
    expect(r.createdOwner).toBe(false);
    expect(r.createdAgent).toBe(true);
    expect(r.ownerUserId).toBe(existing.id);
  });

  it("is idempotent on repeat call with same claims", async () => {
    const { deps } = await setup();
    const first = await ensureAgentAndOwner(makeClaims(), deps);
    const second = await ensureAgentAndOwner(makeClaims(), deps);
    expect(second.createdOwner).toBe(false);
    expect(second.createdAgent).toBe(false);
    expect(second.ownerUserId).toBe(first.ownerUserId);
    expect(second.agentId).toBe(first.agentId);
  });

  it("matches email case-insensitively", async () => {
    const { identity, deps } = await setup();
    const existing = await identity.createUser({ email: "user@example.com" });
    const r = await ensureAgentAndOwner(
      makeClaims({ hid: { email: "User@Example.COM" } }),
      deps,
    );
    expect(r.createdOwner).toBe(false);
    expect(r.ownerUserId).toBe(existing.id);
  });
});
