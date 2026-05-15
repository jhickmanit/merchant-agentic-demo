import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { eq } from "drizzle-orm";
import { agents as agentsTable } from "@/db/schema";
import { registerAgent, revokeAgent, listAgentsForUser } from "@/lib/agents";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryOAuth2ClientProvider } from "@/lib/auth/memory/oauth2-clients";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";

describe("agent orchestration", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  let identity: MemoryIdentityProvider;
  let oauth2: MemoryOAuth2ClientProvider;
  let permission: MemoryPermissionProvider;

  beforeEach(() => {
    testDb = freshTestDb();
    identity = new MemoryIdentityProvider();
    oauth2 = new MemoryOAuth2ClientProvider();
    permission = new MemoryPermissionProvider();
  });

  it("registerAgent: creates Kratos identity, Hydra client, Keto tuple, DB row", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
      spendCapCents: 20000,
    });

    expect(result.id).toBeTruthy();
    expect(result.hydraClientId).toBeTruthy();

    const agent = await identity.getAgentById(result.id);
    expect(agent?.displayName).toBe("Shoppy");

    const client = await oauth2.get(result.hydraClientId);
    expect(client?.metadata.kratos_identity_id).toBe(result.id);

    const tuples = await permission.listForObject("Agent", result.id);
    expect(tuples.find((t) => t.relation === "owner")?.subject).toBe(`User:${owner.id}`);

    const row = await testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, result.id) });
    expect(row?.spendCapCents).toBe(20000);
    expect(row?.displayName).toBe("Shoppy");
    expect(row?.hydraClientId).toBe(result.hydraClientId);
  });

  it("revokeAgent: removes Hydra client, Keto tuple, stamps revokedAt", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
    });

    await revokeAgent(testDb.db, { oauth2, permission }, result.id, owner.id);

    expect(await oauth2.get(result.hydraClientId)).toBeNull();
    const tuples = await permission.listForObject("Agent", result.id);
    expect(tuples).toHaveLength(0);
    const row = await testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, result.id) });
    expect(row?.revokedAt).toBeTruthy();
  });

  it("revokeAgent: throws if caller is not owner", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const otherOwner = await identity.createUser({ email: "bob@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
    });

    await expect(revokeAgent(testDb.db, { oauth2, permission }, result.id, otherOwner.id))
      .rejects.toThrow(/not owned/);
  });

  it("listAgentsForUser returns only the caller's agents, newest first", async () => {
    const alice = await identity.createUser({ email: "alice@example.com" });
    const bob = await identity.createUser({ email: "bob@example.com" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: alice.id, displayName: "A1", agentType: "shopping" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: alice.id, displayName: "A2", agentType: "research" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: bob.id, displayName: "B1", agentType: "general" });
    const alices = await listAgentsForUser(testDb.db, alice.id);
    expect(alices.map((a) => a.displayName).sort()).toEqual(["A1", "A2"]);
  });
});
