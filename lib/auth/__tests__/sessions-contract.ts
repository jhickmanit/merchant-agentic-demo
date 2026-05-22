import { describe, it, expect } from "vitest";
import type { SessionProvider } from "@/lib/auth/sessions";
import type { IdentityProvider } from "@/lib/auth/identity";

interface Context {
  identity: IdentityProvider;
  session: SessionProvider;
}

export function runSessionsContract(name: string, makeProviders: () => Promise<Context>) {
  describe(`${name} — SessionProvider contract`, () => {
    function makeReq(cookieName: string, value?: string) {
      const all = value ? [{ name: cookieName, value }] : [];
      return {
        cookies: {
          get: (n: string) => (n === cookieName && value ? { value } : undefined),
          getAll: () => all,
        },
      };
    }

    it("getCurrentSession returns null when no cookie present", async () => {
      const { session } = await makeProviders();
      const result = await session.getCurrentSession(makeReq(session.cookieName));
      expect(result).toBeNull();
    });

    it("createSession + getCurrentSession round-trip", async () => {
      const { identity, session } = await makeProviders();
      const user = await identity.createUser({ email: "alice@example.com" });
      const { cookieValue } = await session.createSession(user.id);
      const result = await session.getCurrentSession(makeReq(session.cookieName, cookieValue));
      expect(result?.user.id).toBe(user.id);
      expect(result?.user.email).toBe("alice@example.com");
    });

    it("revoke invalidates the session", async () => {
      const { identity, session } = await makeProviders();
      const user = await identity.createUser({ email: "bob@example.com" });
      const { session: created, cookieValue } = await session.createSession(user.id);
      await session.revoke(created.id);
      const result = await session.getCurrentSession(makeReq(session.cookieName, cookieValue));
      expect(result).toBeNull();
    });
  });
}
