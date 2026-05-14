import type { SessionProvider } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import { frontend } from "./client";

const ORY_SESSION_COOKIE = "ory_kratos_session";

export class OrySessionProvider implements SessionProvider {
  readonly cookieName = ORY_SESSION_COOKIE;

  async getCurrentSession(req: { cookies: { get: (name: string) => { value: string } | undefined } }): Promise<{ session: Session; user: User } | null> {
    const cookie = req.cookies.get(this.cookieName);
    if (!cookie) return null;
    try {
      // Session tokens (from native login flows, e.g. e2e test fixtures) start with "ory_st_".
      // Try xSessionToken first for those, then fall back to cookie-based validation.
      const isSessionToken = cookie.value.startsWith("ory_st_");
      const result = await frontend.toSession(
        isSessionToken
          ? { xSessionToken: cookie.value }
          : { cookie: `${this.cookieName}=${cookie.value}` },
      );
      const s = result.data;
      const traits = (s.identity?.traits ?? {}) as { email: string; name?: { first?: string; last?: string } };
      const name = [traits.name?.first, traits.name?.last].filter(Boolean).join(" ").trim();
      return {
        session: {
          id: s.id,
          identityId: s.identity?.id ?? "",
          expiresAt: new Date(s.expires_at ?? Date.now()),
        },
        user: { id: s.identity?.id ?? "", email: traits.email, name: name || undefined },
      };
    } catch {
      return null;
    }
  }

  async createSession(): Promise<{ session: Session; cookieValue: string }> {
    throw new Error("OrySessionProvider.createSession is not supported — sign in via Ory Account Experience");
  }

  async revoke(sessionId: string): Promise<void> {
    // Kratos session revoke is admin-API only and requires the session ID, which we have.
    // Production polish (Phase 10) will wire this via identityAdmin.disableSession().
    // For Phase 2, no-op — the /logout route clears the cookie locally.
    void sessionId;
  }
}
