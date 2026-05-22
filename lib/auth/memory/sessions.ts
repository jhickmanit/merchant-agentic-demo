import { nanoid } from "nanoid";
import type { SessionProvider, SessionRequest } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import type { IdentityProvider } from "@/lib/auth/identity";

export const MEMORY_SESSION_COOKIE = "memory_session";

export class MemorySessionProvider implements SessionProvider {
  readonly cookieName = MEMORY_SESSION_COOKIE;
  private byCookie = new Map<string, Session>();

  constructor(private identities: IdentityProvider) {}

  async createSession(userId: string): Promise<{ session: Session; cookieValue: string }> {
    const cookieValue = nanoid(32);
    const session: Session = {
      id: nanoid(16),
      identityId: userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    };
    this.byCookie.set(cookieValue, session);
    return { session, cookieValue };
  }

  async getCurrentSession(req: SessionRequest): Promise<{ session: Session; user: User } | null> {
    const cookie = req.cookies.get(this.cookieName);
    if (!cookie) return null;
    const session = this.byCookie.get(cookie.value);
    if (!session) return null;
    if (session.expiresAt < new Date()) return null;
    const user = await this.identities.getById(session.identityId);
    if (!user) return null;
    return { session, user };
  }

  async revoke(sessionId: string): Promise<void> {
    for (const [cookie, s] of this.byCookie.entries()) {
      if (s.id === sessionId) this.byCookie.delete(cookie);
    }
  }
}
