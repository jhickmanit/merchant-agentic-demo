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
  });
}
