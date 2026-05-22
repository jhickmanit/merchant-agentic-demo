import { cookies } from "next/headers";
import type { SessionRequest } from "./sessions";

/**
 * Build the `SessionRequest` shape session providers expect from the current
 * Next.js request's cookie store. Centralized here so callers don't have to
 * remember to forward `getAll` (the Ory provider needs it to find the
 * project-specific `ory_session_<slug>` cookie).
 */
export async function buildSessionRequest(): Promise<SessionRequest> {
  const store = await cookies();
  return {
    cookies: {
      get: (n: string) => store.get(n),
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    },
  };
}
