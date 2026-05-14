import type { Session, User } from "./types";

export interface SessionProvider {
  /** Reads the session cookie from the incoming request and resolves it. */
  getCurrentSession(req: { cookies: { get: (name: string) => { value: string } | undefined } }): Promise<{ session: Session; user: User } | null>;
  /** For tests / dev: create a session for a user without going through Kratos. */
  createSession(userId: string): Promise<{ session: Session; cookieValue: string }>;
  /** Revoke (sign out). */
  revoke(sessionId: string): Promise<void>;
  /** The cookie name this provider expects (e.g. "ory_kratos_session" or "memory_session"). */
  readonly cookieName: string;
}
