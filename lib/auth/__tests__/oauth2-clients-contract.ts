import { describe, it, expect } from "vitest";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";

export function runOAuth2ClientsContract(name: string, makeProvider: () => Promise<OAuth2ClientProvider>) {
  describe(`${name} — OAuth2ClientProvider contract`, () => {
    it("create returns a client with id, ownerIdentityId, grantTypes, metadata", async () => {
      const p = await makeProvider();
      const c = await p.create({
        ownerIdentityId: "user-1",
        grantTypes: ["client_credentials"],
        metadata: { kratos_identity_id: "agent-abc" },
      });
      expect(c.id).toBeTruthy();
      expect(c.ownerIdentityId).toBe("user-1");
      expect(c.grantTypes).toEqual(["client_credentials"]);
      expect(c.metadata.kratos_identity_id).toBe("agent-abc");
    });

    it("get returns a created client", async () => {
      const p = await makeProvider();
      const c = await p.create({ ownerIdentityId: "u", grantTypes: ["client_credentials"] });
      const found = await p.get(c.id);
      expect(found?.id).toBe(c.id);
    });

    it("get returns null for unknown id", async () => {
      const p = await makeProvider();
      expect(await p.get("nope")).toBeNull();
    });

    it("revoke removes the client", async () => {
      const p = await makeProvider();
      const c = await p.create({ ownerIdentityId: "u", grantTypes: ["client_credentials"] });
      await p.revoke(c.id);
      expect(await p.get(c.id)).toBeNull();
    });
  });
}
