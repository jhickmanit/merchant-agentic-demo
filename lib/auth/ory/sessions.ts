import type { SessionProvider } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import { Configuration, IdentityApi } from "@ory/client";
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
    const apiKey = process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY;
    if (!apiKey || !process.env.ORY_SDK_URL) {
      return; // not configured for admin operations
    }
    const admin = new IdentityApi(
      new Configuration({
        basePath: process.env.ORY_SDK_URL,
        baseOptions: { headers: { Authorization: `Bearer ${apiKey}` } },
      }),
    );
    try {
      await admin.disableSession({ id: sessionId });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) return; // already revoked or never existed
      throw err;
    }
  }
}
