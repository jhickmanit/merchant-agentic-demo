import { describe, it, expect } from "vitest";
import type { IdentityProvider } from "@/lib/auth/identity";

export function runIdentityContract(name: string, makeProvider: () => Promise<IdentityProvider>) {
  describe(`${name} — IdentityProvider contract`, () => {
    it("createUser returns a user with id and email", async () => {
      const p = await makeProvider();
      const u = await p.createUser({ email: "alice@example.com", name: "Alice" });
      expect(u.id).toBeTruthy();
      expect(u.email).toBe("alice@example.com");
      expect(u.name).toBe("Alice");
    });

    it("getById finds a created user", async () => {
      const p = await makeProvider();
      const u = await p.createUser({ email: "bob@example.com" });
      const found = await p.getById(u.id);
      expect(found?.email).toBe("bob@example.com");
    });

    it("getById returns null for unknown id", async () => {
      const p = await makeProvider();
      expect(await p.getById("nope")).toBeNull();
    });

    it("getByEmail is case-insensitive", async () => {
      const p = await makeProvider();
      await p.createUser({ email: "carol@example.com" });
      const found = await p.getByEmail("CAROL@EXAMPLE.COM");
      expect(found?.email).toBe("carol@example.com");
    });

    it("getByEmail returns null for unknown email", async () => {
      const p = await makeProvider();
      expect(await p.getByEmail("nope@nope")).toBeNull();
    });

    it("createAgent returns an agent with id, displayName, ownerIdentityId, agentType", async () => {
      const p = await makeProvider();
      const owner = await p.createUser({ email: "owner-a@example.com" });
      const agent = await p.createAgent({
        displayName: "Shoppy",
        ownerIdentityId: owner.id,
        agentType: "shopping",
      });
      expect(agent.id).toBeTruthy();
      expect(agent.displayName).toBe("Shoppy");
      expect(agent.ownerIdentityId).toBe(owner.id);
      expect(agent.agentType).toBe("shopping");
    });

    it("getAgentById round-trips", async () => {
      const p = await makeProvider();
      const owner = await p.createUser({ email: "owner-b@example.com" });
      const agent = await p.createAgent({ displayName: "A", ownerIdentityId: owner.id, agentType: "shopping" });
      const found = await p.getAgentById(agent.id);
      expect(found?.displayName).toBe("A");
    });

    it("listAgentsByOwner filters by owner", async () => {
      const p = await makeProvider();
      const o1 = await p.createUser({ email: "o1@example.com" });
      const o2 = await p.createUser({ email: "o2@example.com" });
      await p.createAgent({ displayName: "A1", ownerIdentityId: o1.id, agentType: "shopping" });
      await p.createAgent({ displayName: "A2", ownerIdentityId: o1.id, agentType: "research" });
      await p.createAgent({ displayName: "B1", ownerIdentityId: o2.id, agentType: "general" });
      const o1Agents = await p.listAgentsByOwner(o1.id);
      expect(o1Agents).toHaveLength(2);
    });
  });
}
