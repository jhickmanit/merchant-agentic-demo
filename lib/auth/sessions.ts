import type { Session, User } from "./types";

/**
 * Minimal cookie-store shape session providers need. Both `get` and `getAll`
 * are required so providers can discover project-specific cookies (Ory Network
 * uses `ory_session_<slug>`, which varies per project) without hardcoding.
 *
 * Use `buildSessionRequest()` from `lib/auth/request.ts` to construct this from
 * a Next.js `next/headers` cookies store.
 */
export interface SessionRequest {
  cookies: {
    get: (name: string) => { value: string } | undefined;
    getAll: () => Array<{ name: string; value: string }>;
  };
}

export interface SessionProvider {
  /** Reads the session cookie from the incoming request and resolves it. */
  getCurrentSession(req: SessionRequest): Promise<{ session: Session; user: User } | null>;
  /** For tests / dev: create a session for a user without going through Kratos. */
  createSession(userId: string): Promise<{ session: Session; cookieValue: string }>;
  /** Revoke (sign out). */
  revoke(sessionId: string): Promise<void>;
  /** The cookie name this provider expects (e.g. "ory_kratos_session" or "memory_session"). */
  readonly cookieName: string;
}
