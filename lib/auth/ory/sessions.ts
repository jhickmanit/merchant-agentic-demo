import type { SessionProvider, SessionRequest } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import { Configuration, IdentityApi } from "@ory/client";
import { frontend } from "./client";

// Ory Network sets the browser session cookie as `ory_session_<slug>` (project-specific).
// Self-hosted Kratos uses `ory_kratos_session`. We just detect any of these by prefix so this
// works for any project without hardcoding a slug.
function isOrySessionCookieName(name: string): boolean {
  return name === "ory_kratos_session" || name.startsWith("ory_session_");
}

export class OrySessionProvider implements SessionProvider {
  readonly cookieName = "ory_kratos_session"; // fallback label; real lookup is dynamic

  async getCurrentSession(req: SessionRequest): Promise<{ session: Session; user: User } | null> {
    const match = req.cookies.getAll().find((c) => isOrySessionCookieName(c.name));
    if (!match) return null;
    const cookie = { value: match.value };
    const matchedName = match.name;
    try {
      // Session tokens (from native login flows, e.g. e2e test fixtures) start with "ory_st_".
      // Try xSessionToken first for those, then fall back to cookie-based validation.
      const isSessionToken = cookie.value.startsWith("ory_st_");
      const result = await frontend.toSession(
        isSessionToken
          ? { xSessionToken: cookie.value }
          : { cookie: `${matchedName}=${cookie.value}` },
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
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      console.error(
        `[OrySessionProvider] toSession failed for cookie=${matchedName} status=${status}`,
        data ?? (err as Error).message,
      );
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
